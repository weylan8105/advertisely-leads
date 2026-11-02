import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { isStripeConfigured } from "@/lib/stripe";
import { SUB_MIN_WEEKLY_CENTS, SUB_PRICE_PER_LEAD_CENTS, SUB_MIN_WEEKS, leadsForCents } from "@/lib/leadSubscription";
import { LEAD_SUBSCRIPTIONS_PUBLIC } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/subscription — the caller's lead-subscription status + delivery. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const base = {
    available: isStripeConfigured,
    canSubscribe: LEAD_SUBSCRIPTIONS_PUBLIC || isAdmin,
    minWeeklyCents: SUB_MIN_WEEKLY_CENTS,
    weeklyCents: SUB_MIN_WEEKLY_CENTS, // default for the subscribe form
    pricePerLeadCents: SUB_PRICE_PER_LEAD_CENTS,
    leadsPerWeek: leadsForCents(SUB_MIN_WEEKLY_CENTS).leads,
    minWeeks: SUB_MIN_WEEKS,
  };

  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ ...base, subscribed: false, licensedStates: [] });

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { licensedStates: true } });
  const withLicensed = { ...base, licensedStates: me?.licensedStates ?? [] };

  const sub = await prisma.leadSubscription.findFirst({
    where: { userId, status: { not: "canceled" } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) return NextResponse.json({ ...withLicensed, subscribed: false });

  // Delivery so far across this subscription's weekly orders.
  const orders = await prisma.order.findMany({
    where: { userId, stripeInvoiceId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { quantity: true, fulfilledCount: true, createdAt: true },
  });
  const totalDelivered = orders.reduce((s, o) => s + o.fulfilledCount, 0);
  const latest = orders[0] ?? null;

  // This-cycle progress from the subscription Order(s) created in the last 8
  // days — order-capped, so it reflects exactly what was paid and never reads
  // over the allotment. Falls back to the weekly allotment before any order.
  const cycleOrders = await prisma.order.findMany({
    where: {
      userId,
      stripeInvoiceId: { not: null },
      status: { notIn: ["REFUNDED"] },
      createdAt: { gte: new Date(Date.now() - 8 * 86_400_000) },
    },
    select: { quantity: true, fulfilledCount: true },
  });
  const orderedThisCycle = cycleOrders.reduce((s, o) => s + o.quantity, 0) || leadsForCents(sub.weeklyCents).leads;
  const deliveredThisWeek = cycleOrders.reduce((s, o) => s + Math.min(o.fulfilledCount, o.quantity), 0);

  return NextResponse.json({
    ...base,
    subscribed: true,
    weeklyCents: sub.weeklyCents,
    leadsPerWeek: orderedThisCycle,
    deliveredThisWeek,
    status: sub.status,
    filterStates: sub.filterStates,
    weeksBilled: sub.weeksBilled,
    rolloverCents: sub.rolloverCents,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAt: sub.cancelAt,
    canceledAt: sub.canceledAt,
    canCancel: sub.weeksBilled >= sub.minWeeks && !sub.cancelAt,
    totalDelivered,
    weeksDelivered: orders.length,
    thisWeek: latest ? { quantity: latest.quantity, fulfilled: latest.fulfilledCount } : null,
  });
}
