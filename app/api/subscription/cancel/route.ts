import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86_400;

/**
 * POST /api/subscription/cancel — cancel the caller's lead subscription.
 * Honors the 4-week minimum: if they're still inside it, the subscription is
 * scheduled to end at the 4-week mark (they're billed through the minimum);
 * otherwise it ends at the end of the current week.
 */
export async function POST() {
  if (!isStripeConfigured || !stripe) return NextResponse.json({ error: "Payments aren't set up." }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sub = await prisma.leadSubscription.findFirst({
    where: { userId, status: { in: ["active", "past_due", "incomplete"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!sub) return NextResponse.json({ error: "No active subscription." }, { status: 400 });
  if (sub.cancelAt) return NextResponse.json({ error: "Your subscription is already set to cancel." }, { status: 400 });

  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);

    if (sub.weeksBilled >= sub.minWeeks) {
      // Past the minimum → stop at the end of the current week.
      const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
      const when = (updated as any).current_period_end ? new Date((updated as any).current_period_end * 1000) : null;
      await prisma.leadSubscription.update({ where: { id: sub.id }, data: { cancelAt: when } });
      return NextResponse.json({ ok: true, cancelAt: when, message: "Your subscription will end at the end of this week." });
    }

    // Inside the 4-week minimum → schedule cancellation at the 4-week mark.
    const startSec = (stripeSub as any).start_date ?? Math.floor(sub.createdAt.getTime() / 1000);
    const cancelAtSec = startSec + sub.minWeeks * 7 * DAY;
    await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at: cancelAtSec });
    const when = new Date(cancelAtSec * 1000);
    await prisma.leadSubscription.update({ where: { id: sub.id }, data: { cancelAt: when } });
    return NextResponse.json({
      ok: true,
      cancelAt: when,
      message: `You're within the 4-week minimum, so your subscription stays active (and billed weekly) until it ends on ${when.toLocaleDateString()}.`,
    });
  } catch (e: any) {
    console.error("Subscription cancel failed:", e?.message ?? e);
    return NextResponse.json({ error: "Could not cancel. Please try again." }, { status: 502 });
  }
}
