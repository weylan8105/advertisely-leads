import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPPORT_EMAIL = "support@advertisely.io";

/**
 * POST /api/subscription/cancel — cancel the caller's lead subscription.
 * Self-service cancellation is only allowed AFTER the 4-week minimum (4 paid
 * weeks). Before that, we refuse and direct them to support.
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

  // Inside the 4-week minimum → no self-service cancel; direct them to support.
  if (sub.weeksBilled < sub.minWeeks) {
    return NextResponse.json(
      {
        error: "support_required",
        needsSupport: true,
        supportEmail: SUPPORT_EMAIL,
        message: `You're in your ${sub.minWeeks}-week minimum (${sub.weeksBilled} of ${sub.minWeeks} payments made). To cancel before the minimum is met, please reach out to support at ${SUPPORT_EMAIL}.`,
      },
      { status: 403 },
    );
  }

  try {
    // Past the minimum → stop at the end of the current week.
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
    const when = (updated as any).current_period_end ? new Date((updated as any).current_period_end * 1000) : null;
    await prisma.leadSubscription.update({ where: { id: sub.id }, data: { cancelAt: when } });
    return NextResponse.json({ ok: true, cancelAt: when, message: "Your subscription will end at the end of this week." });
  } catch (e: any) {
    console.error("Subscription cancel failed:", e?.message ?? e);
    return NextResponse.json({ error: "Could not cancel. Please try again." }, { status: 502 });
  }
}
