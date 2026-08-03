import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
import { findPackage } from "@/data/packages";
import { sendOrderConfirmationEmail, sendThankYouEmail, isEmailConfigured } from "@/lib/email";
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

  // We only care about successful payments for the lead-purchase flow.
  if (event.type === "payment_intent.succeeded") {
    await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
  } else if (event.type === "payment_intent.payment_failed") {
    console.log(
      "Stripe webhook: payment failed",
      (event.data.object as Stripe.PaymentIntent).id,
    );
  }

  return NextResponse.json({ received: true });
}

async function handlePaymentSucceeded(intent: Stripe.PaymentIntent) {
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

  // Cart line items. New checkouts send `items` (JSON [{p,q}]); fall back to the
  // legacy single-item metadata for any older intents.
  type Line = { packageId: string; quantity: number };
  let lines: Line[] = [];
  if (md.items) {
    try {
      const parsed = JSON.parse(md.items) as { p: string; q: number }[];
      lines = parsed.map((x) => ({ packageId: x.p, quantity: Number(x.q) }));
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

  // One Order per cart line. Price + age window resolve from the package def so
  // buckets keep their identity while fulfillment matches the underlying pool.
  const createdOrders: { id: string; packageId: string }[] = [];
  let totalQty = 0;
  for (const line of lines) {
    const pkg = findPackage(line.packageId);
    if (!pkg) {
      console.error("Stripe webhook: unknown package on", intent.id, line.packageId);
      continue;
    }
    const cents = Math.round(pkg.pricePerLead * 100);
    const order = await prisma.order.create({
      data: {
        userId: md.userId,
        packageId: pkg.id, // bucket id, for display
        quantity: line.quantity,
        pricePerLeadCents: cents,
        totalCents: cents * line.quantity,
        filterStates,
        filterAgeMinDays: pkg.ageMinDays,
        filterAgeMaxDays: pkg.ageMaxDays,
        status: "PROCESSING",
        stripePaymentIntentId: intent.id,
      },
    });
    createdOrders.push({ id: order.id, packageId: order.packageId });
    totalQty += line.quantity;
    // Immediately try to fill each order from existing inventory.
    await fulfillOrder(order.id);
  }
  if (createdOrders.length === 0) return;
  const firstOrder = createdOrders[0];

  // Send order confirmation + thank-you, summarized across the whole cart.
  if (isEmailConfigured) {
    try {
      const user = await prisma?.user.findUnique({
        where: { id: md.userId },
        select: { email: true, name: true },
      });
      if (user?.email) {
        const label =
          createdOrders.length === 1
            ? findPackage(createdOrders[0].packageId)?.name ?? createdOrders[0].packageId
            : `${createdOrders.length} lead tiers`;
        // Transactional receipt
        await sendOrderConfirmationEmail({
          agentEmail: user.email,
          agentName: user.name ?? "Agent",
          packageName: label,
          quantity: totalQty,
          totalCents: intent.amount,
          orderId: firstOrder.id,
        });
        // Personal thank-you
        await sendThankYouEmail({
          clientEmail: user.email,
          clientName: user.name ?? "Agent",
          packageName: label,
          quantity: totalQty,
          totalCents: intent.amount,
          orderId: firstOrder.id,
        });
      }
    } catch (emailErr) {
      console.warn("Order emails failed:", emailErr);
    }
  }
}
