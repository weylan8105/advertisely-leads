import { NextRequest, NextResponse } from "next/server";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
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
  if (!md.userId || !md.packageId || !md.quantity) {
    console.error("Stripe webhook: missing metadata on", intent.id, md);
    return;
  }

  const quantity = parseInt(md.quantity, 10);
  const pricePerLeadCents = Math.round(parseFloat(md.pricePerLead) * 100);
  const filterStates = md.filterStates
    ? md.filterStates.split(",").filter(Boolean)
    : [];
  const filterIncomeMin = md.filterIncomeMin
    ? parseInt(md.filterIncomeMin, 10)
    : undefined;

  const order = await prisma.order.create({
    data: {
      userId: md.userId,
      packageId: md.packageId,
      quantity,
      pricePerLeadCents,
      totalCents: intent.amount,
      filterStates,
      filterIncomeMin,
      status: "PROCESSING",
      stripePaymentIntentId: intent.id,
    },
  });

  // Immediately try to fill the new order from existing lead inventory.
  await fulfillOrder(order.id);

  // Send order confirmation email
  if (isEmailConfigured) {
    try {
      const user = await prisma?.user.findUnique({
        where: { id: md.userId },
        select: { email: true, name: true },
      });
      if (user?.email) {
        // Transactional receipt
        await sendOrderConfirmationEmail({
          agentEmail: user.email,
          agentName: user.name ?? "Agent",
          packageName: md.packageName ?? md.packageId,
          quantity,
          totalCents: intent.amount,
          orderId: order.id,
        });
        // Personal thank-you from Ryan Rush
        await sendThankYouEmail({
          clientEmail: user.email,
          clientName: user.name ?? "Agent",
          packageName: md.packageName ?? md.packageId,
          quantity,
          totalCents: intent.amount,
          orderId: order.id,
        });
      }
    } catch (emailErr) {
      console.warn("Order emails failed:", emailErr);
    }
  }
}
