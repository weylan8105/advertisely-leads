import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { randomUUID } from "crypto";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { LEADS_PURCHASE_PAUSED, PURCHASE_PAUSED_MESSAGE, REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { quoteCheckout, type CheckoutBody } from "@/lib/checkoutQuote";
import { placeCheckoutOrders } from "@/lib/checkoutOrders";
import { isAdminRole } from "@/lib/referral";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/bucks-order — place an order paid ENTIRELY with
 * Advertisely Bucks (no card). Same body as create-payment-intent, with
 * useBucks: true. Referral program draft; 404 while the flag is off.
 */
export async function POST(req: NextRequest) {
  if (!REFERRAL_PROGRAM_ENABLED) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (LEADS_PURCHASE_PAUSED) return NextResponse.json({ error: PURCHASE_PAUSED_MESSAGE }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user?.id) return NextResponse.json({ error: "You must be signed in to check out" }, { status: 401 });
  if (isAdminRole(user.role)) return NextResponse.json({ error: "Advertisely Bucks aren't available on admin accounts." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as CheckoutBody;
  const quote = await quoteCheckout({ id: user.id, role: user.role }, { ...body, useBucks: true });
  if (!quote.ok) return NextResponse.json(quote.body, { status: quote.status });
  const { priced, referral } = quote;
  if (priced.chargeCents !== 0 || priced.bucksAppliedCents <= 0) {
    return NextResponse.json({ error: "Your Bucks don't cover this whole order — pay the rest by card." }, { status: 409 });
  }

  // Reserve the Bucks atomically first, so two tabs can't spend the same balance.
  // settleBucks later sees this SPEND row (same paymentRef) and skips it.
  const paymentRef = `bucks:${randomUUID()}`;
  const spend = priced.bucksAppliedCents;
  const reserved = await prisma.$transaction(async (tx) => {
    const res = await tx.user.updateMany({
      where: { id: user.id, bucksCents: { gte: spend } },
      data: { bucksCents: { decrement: spend } },
    });
    if (res.count === 0) return false;
    await tx.bucksTransaction.create({
      data: { userId: user.id, amountCents: -spend, kind: "SPEND", note: "Spent on a lead order", paymentRef },
    });
    return true;
  });
  if (!reserved) return NextResponse.json({ error: "Your Bucks balance changed — refresh and try again." }, { status: 409 });

  try {
    const orders = await placeCheckoutOrders({
      userId: user.id,
      lines: priced.lines,
      filterStates: quote.filterStates,
      deliverToUserId: quote.deliverToUserId || null,
      paymentRef,
      chargedCents: 0,
      referral: referral ? { ...referral, earnsCents: priced.referrerEarnsCents } : null,
      discountCents: priced.discountCents,
      bucksAppliedCents: spend,
    });
    if (orders.length === 0) throw new Error("no orders created");
    await prisma.bucksTransaction.updateMany({ where: { paymentRef, userId: user.id, kind: "SPEND" }, data: { orderId: orders[0].id } });
    return NextResponse.json({ ok: true, orderIds: orders.map((o) => o.id) });
  } catch (e) {
    // Give the Bucks back if the order couldn't be created.
    console.error("bucks-order failed; refunding reservation", paymentRef, e);
    await prisma.$transaction([
      prisma.bucksTransaction.deleteMany({ where: { paymentRef, userId: user.id, kind: "SPEND" } }),
      prisma.user.update({ where: { id: user.id }, data: { bucksCents: { increment: spend } } }),
    ]);
    return NextResponse.json({ error: "Couldn't place the order. Your Bucks were not spent." }, { status: 500 });
  }
}
