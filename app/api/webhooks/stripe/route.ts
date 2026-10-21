import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { processPaidInvoice, upsertLocalSubscription } from "@/lib/leadSubscription";
import { placeCheckoutOrders, type PaidLine } from "@/lib/checkoutOrders";
import { clawbackReferralBucks } from "@/lib/referral";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook. Listens for payment_intent.succeeded → creates Order + fulfills.
 *
 * The webhook secret must match what's configured in your Stripe dashboard
 * under Developers → Webhooks → Endpoint signing secret.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 },
    );
  }
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.warn("Stripe webhook: invalid signature", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  try {
    switch (event.type) {
      // ── One-off lead purchases ──────────────────────────────────────────
      case "payment_intent.succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case "charge.refunded": {
        // Advertisely Bucks Marketing Campaign: take back the referrer's Bucks
        // for a refunded referred order (only what's still unspent).
        const ch = event.data.object as Stripe.Charge;
        const pi = typeof ch.payment_intent === "string" ? ch.payment_intent : ch.payment_intent?.id;
        if (pi) await clawbackReferralBucks(pi, ch.amount_refunded, ch.amount);
        break;
      }
      case "payment_intent.payment_failed":
        console.log("Stripe webhook: payment failed", (event.data.object as Stripe.PaymentIntent).id);
        break;

      // ── Weekly lead subscriptions ───────────────────────────────────────
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode === "subscription" && s.subscription && stripe) {
          const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
          await upsertLocalSubscription(await stripe.subscriptions.retrieve(subId));
        }
        break;
      }
      case "invoice.paid":
        // Each paid weekly invoice → that week's fresh-lead order (idempotent).
        await processPaidInvoice(event.data.object as Stripe.Invoice);
        break;
      case "customer.subscription.updated":
        await upsertLocalSubscription(event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        if (prisma) {
          await prisma.leadSubscription.updateMany({
            where: { stripeSubscriptionId: (event.data.object as Stripe.Subscription).id },
            data: { status: "canceled", canceledAt: new Date() },
          });
        }
        break;
      case "invoice.payment_failed":
        console.log("Stripe webhook: subscription invoice failed", (event.data.object as Stripe.Invoice).id);
        break;
    }
  } catch (err) {
    // Log but still 200 so Stripe doesn't hammer retries on a transient error.
    console.error("Stripe webhook handler error:", event.type, err);
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentSucceeded(intent: Stripe.PaymentIntent) {
  // Subscription payments are invoice-driven — handled by invoice.paid, not here.
  if ((intent as any).invoice) return;
  if (!isDatabaseConfigured || !prisma) {
    console.error(
      "Stripe webhook: payment succeeded but DB not configured — order not created!",
      intent.id,
    );
    return;
  }

  // Idempotency — if we've already created an order for this PaymentIntent, skip.
  const existing = await prisma.order.findFirst({
    where: { stripePaymentIntentId: intent.id },
  });
  if (existing) {
    console.log("Stripe webhook: order already exists for", intent.id);
    return;
  }

  const md = intent.metadata ?? {};
  if (!md.userId) {
    console.error("Stripe webhook: missing userId on", intent.id, md);
    return;
  }

  const filterStates = md.filterStates ? md.filterStates.split(",").filter(Boolean) : [];
  // Optional team delivery target chosen at checkout (validated when the intent
  // was created). Empty string = deliver to the buyer. Re-validated against the
  // buyer's org below before it's stamped on any order.
  const deliverToUserId = md.deliverToUserId && md.deliverToUserId.length > 0 ? md.deliverToUserId : null;

  // Cart line items. New checkouts send `items` (JSON [{p,q}]); fall back to the
  // legacy single-item metadata for any older intents.
  let lines: PaidLine[] = [];
  if (md.items) {
    try {
      const parsed = JSON.parse(md.items) as { p: string; q: number; c?: number }[];
      lines = parsed.map((x) => ({ packageId: x.p, quantity: Number(x.q), centsPerLead: x.c != null ? Number(x.c) : undefined }));
    } catch {
      console.error("Stripe webhook: bad items metadata on", intent.id, md.items);
    }
  } else if (md.packageId && md.quantity) {
    lines = [{ packageId: md.packageId, quantity: parseInt(md.quantity, 10) }];
  }
  if (lines.length === 0) {
    console.error("Stripe webhook: no line items on", intent.id, md);
    return;
  }

  await placeCheckoutOrders({
    userId: md.userId,
    lines,
    filterStates,
    deliverToUserId,
    paymentRef: intent.id,
    stripePaymentIntentId: intent.id,
    chargedCents: intent.amount,
    referral: md.referralCode && md.referrerUserId
      ? { code: md.referralCode, ownerId: md.referrerUserId, earnsCents: parseInt(md.referrerEarnsCents || "0", 10) || 0 }
      : null,
    discountCents: parseInt(md.discountCents || "0", 10) || 0,
    bucksAppliedCents: parseInt(md.bucksCents || "0", 10) || 0,
  });
}
