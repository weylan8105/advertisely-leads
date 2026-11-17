import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { AVAILABLE_STATES } from "@/data/states";
import { ADVERTISER_PROGRAM, ADVERTISER_PROGRAM_KIND } from "@/lib/advertiserProgram";
import { enforceAdSpend, forgetAdSpendSummary } from "@/lib/adSpend";
import {
  enrollProgramMember,
  findProgramSubscriptions,
  getProgramPriceId,
  isOnFeeWaiverTeam,
  joinWithFeeWaived,
} from "@/lib/advertiserProgramBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/advertiser-program/checkout { states } — join the Advertiser Program
 * ($500 every 2 weeks). On the Enhanced Wealth team the membership is waived:
 * they join on the spot with no checkout (lib/advertiserProgram.ts FEE_WAIVER).
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured || !stripe) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { states?: string[] };
  const valid = new Set(AVAILABLE_STATES.map((s) => String(s).toUpperCase()));
  const states = [...new Set((body.states ?? []).map((s) => String(s).toUpperCase()).filter((s) => valid.has(s)))];
  if (states.length === 0) return NextResponse.json({ error: "Pick the states you're licensed in." }, { status: 400 });

  const [subs, onWaiverTeam] = await Promise.all([findProgramSubscriptions(userId, user.email), isOnFeeWaiverTeam(userId)]);
  const live = subs.filter((s) => ["active", "trialing", "past_due"].includes(s.status));
  // A waived membership from a team they've since left no longer counts: end it, then they join like anyone.
  const stale = onWaiverTeam ? [] : live.filter((s) => !!s.metadata?.feeWaived);
  if (live.length > stale.length) {
    return NextResponse.json({ error: "You're already in the Advertiser Program." }, { status: 400 });
  }
  for (const s of stale) await stripe.subscriptions.cancel(s.id).catch((e) => console.warn("[program] ending a stale waived membership failed", e?.message));

  // Shared-pool leads only go to members licensed in the lead's state.
  await prisma.user.update({ where: { id: userId }, data: { licensedStates: states } });

  // Pay on their own Stripe customer, so the payments show on their advertiser account.
  const existing = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0];
  const customer = existing ?? (await stripe.customers.create({ email: user.email, name: user.name ?? undefined, metadata: { userId } }));
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const metadata = { kind: ADVERTISER_PROGRAM_KIND, userId };

  if (onWaiverTeam) {
    try {
      await joinWithFeeWaived(userId, customer.id);
    } catch (e: any) {
      console.error("Advertiser program waived join failed:", e?.message ?? e);
      return NextResponse.json({ error: "Could not start your membership. Please try again." }, { status: 502 });
    }
    // No checkout and no paid invoice to wait for: they're a member now.
    await enrollProgramMember(userId);
    forgetAdSpendSummary(userId);
    await enforceAdSpend(userId).catch((e) => console.warn("[program] enforce failed", (e as Error).message));
    return NextResponse.json({ url: `${base}/marketplace?tab=advertise&status=waived`, waived: true });
  }

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items: [{ price: await getProgramPriceId(), quantity: 1 }],
      subscription_data: { metadata, description: ADVERTISER_PROGRAM.name },
      metadata,
      success_url: `${base}/marketplace?tab=advertise&status=success`,
      cancel_url: `${base}/marketplace?tab=advertise&status=cancel`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    console.error("Advertiser program checkout failed:", e?.message ?? e);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
