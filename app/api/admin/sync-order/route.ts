import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/sync-order
 * Body: { paymentIntentId: string }
 *
 * Manually recovers a Stripe PaymentIntent into the Orders table.
 * Useful when the webhook missed a payment (e.g. STRIPE_WEBHOOK_SECRET
 * was not yet configured at the time of purchase).
 *
 * Requires ADMIN role.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { paymentIntentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { paymentIntentId } = body;
  if (!paymentIntentId) {
    return NextResponse.json({ error: "paymentIntentId is required" }, { status: 400 });
  }

  // Fetch the PaymentIntent from Stripe
  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Stripe error: ${err.message}` },
      { status: 400 },
    );
  }

  if (intent.status !== "succeeded") {
    return NextResponse.json(
      { error: `PaymentIntent status is "${intent.status}", not "succeeded"` },
      { status: 400 },
    );
  }

  // Idempotency check
  const existing = await prisma.order.findFirst({
    where: { stripePaymentIntentId: intent.id },
  });
  if (existing) {
    return NextResponse.json({
      message: "Order already exists — no action needed",
      orderId: existing.id,
      status: existing.status,
    });
  }

  const md = intent.metadata ?? {};

  // If metadata is missing (old checkout before metadata was added),
  // we still create a best-effort order using the amount and any available info.
  const userId = md.userId || null;
  const packageId = md.packageId || "unknown";
  const quantity = md.quantity ? parseInt(md.quantity, 10) : 0;
  const pricePerLeadCents = md.pricePerLead
    ? Math.round(parseFloat(md.pricePerLead) * 100)
    : quantity > 0
    ? Math.round(intent.amount / quantity)
    : 0;
  const filterStates = md.filterStates
    ? md.filterStates.split(",").filter(Boolean)
    : [];
  const filterIncomeMin = md.filterIncomeMin
    ? parseInt(md.filterIncomeMin, 10)
    : undefined;

  if (!userId) {
    return NextResponse.json(
      {
        error:
          "PaymentIntent has no userId in metadata. This payment was made before metadata was wired up. " +
          "Please provide the userId manually via the override field.",
        metadata: md,
        amount: intent.amount,
        description: intent.description,
      },
      { status: 422 },
    );
  }

  const order = await prisma.order.create({
    data: {
      userId,
      packageId,
      quantity,
      pricePerLeadCents,
      totalCents: intent.amount,
      filterStates,
      filterIncomeMin,
      status: "PROCESSING",
      stripePaymentIntentId: intent.id,
    },
  });

  // Try to fulfill from existing inventory
  const assigned = await fulfillOrder(order.id);

  return NextResponse.json({
    message: "Order synced successfully",
    orderId: order.id,
    quantity,
    fulfilled: assigned,
    status: assigned >= quantity ? "DELIVERED" : "DELIVERING",
    totalCents: intent.amount,
  });
}

/**
 * POST /api/admin/sync-order with override userId
 * Body: { paymentIntentId: string, overrideUserId: string }
 *
 * Same as above but allows specifying the userId manually when metadata is missing.
 */
export async function PUT(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  let body: { paymentIntentId?: string; overrideUserId?: string; packageId?: string; quantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { paymentIntentId, overrideUserId, packageId, quantity } = body;
  if (!paymentIntentId || !overrideUserId) {
    return NextResponse.json(
      { error: "paymentIntentId and overrideUserId are required" },
      { status: 400 },
    );
  }

  let intent: Stripe.PaymentIntent;
  try {
    intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (err: any) {
    return NextResponse.json({ error: `Stripe error: ${err.message}` }, { status: 400 });
  }

  if (intent.status !== "succeeded") {
    return NextResponse.json(
      { error: `PaymentIntent status is "${intent.status}", not "succeeded"` },
      { status: 400 },
    );
  }

  // Idempotency check
  const existing = await prisma.order.findFirst({
    where: { stripePaymentIntentId: intent.id },
  });
  if (existing) {
    return NextResponse.json({
      message: "Order already exists — no action needed",
      orderId: existing.id,
    });
  }

  const md = intent.metadata ?? {};
  const resolvedPackageId = packageId || md.packageId || "unknown";
  const resolvedQty = quantity || (md.quantity ? parseInt(md.quantity, 10) : 0);
  const pricePerLeadCents = resolvedQty > 0
    ? Math.round(intent.amount / resolvedQty)
    : 0;
  const filterStates = md.filterStates
    ? md.filterStates.split(",").filter(Boolean)
    : [];
  const filterIncomeMin = md.filterIncomeMin
    ? parseInt(md.filterIncomeMin, 10)
    : undefined;

  const order = await prisma.order.create({
    data: {
      userId: overrideUserId,
      packageId: resolvedPackageId,
      quantity: resolvedQty,
      pricePerLeadCents,
      totalCents: intent.amount,
      filterStates,
      filterIncomeMin,
      status: "PROCESSING",
      stripePaymentIntentId: intent.id,
    },
  });

  const assigned = await fulfillOrder(order.id);

  return NextResponse.json({
    message: "Order synced with override userId",
    orderId: order.id,
    userId: overrideUserId,
    quantity: resolvedQty,
    fulfilled: assigned,
    totalCents: intent.amount,
  });
}
