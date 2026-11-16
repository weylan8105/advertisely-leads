import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { isStripeConfigured } from "@/lib/stripe";
import { getAdSpendSummary } from "@/lib/adSpend";
import { sharedCplCents } from "@/lib/sharedPool";
import {
  ADVERTISER_PROGRAM,
  programCreditCents,
  programFeeCents,
  programLeadPriceCents,
  legacyRetainerEnds,
  mustJoinProgram,
} from "@/lib/advertiserProgram";
import { findProgramSubscriptions, syncProgramMember } from "@/lib/advertiserProgramBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LIVE = new Set(["active", "trialing", "past_due"]);

/**
 * GET /api/advertiser-program — the Advertiser Program card in the marketplace:
 * the offer at today's cost per lead, and the signed-in user's membership,
 * balance and leads. Also records any payment the webhook missed.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, licensedStates: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const subs = isStripeConfigured ? await findProgramSubscriptions(userId, user.email).catch(() => []) : [];
  await syncProgramMember(userId, subs).catch((e) => console.warn("[program] sync failed", (e as Error).message));

  const live = subs.find((s) => LIVE.has(s.status));
  const periodEnd = (s: any) => s.items?.data?.[0]?.current_period_end ?? s.current_period_end ?? null;
  const fresh = await prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true } });
  const summary = fresh?.isAdvertiser ? await getAdSpendSummary(userId, { fresh: true }).catch(() => null) : null;
  const programSubs = subs.map((s) => ({ program: true, status: s.status }));
  const [abca, ew] = await Promise.all([sharedCplCents("abca"), sharedCplCents("ew")]);
  const legacyUntil = legacyRetainerEnds(user.email);

  return NextResponse.json({
    available: isStripeConfigured,
    offer: {
      name: ADVERTISER_PROGRAM.name,
      amountCents: ADVERTISER_PROGRAM.amountCents,
      intervalWeeks: ADVERTISER_PROGRAM.intervalWeeks,
      feeCents: programFeeCents(ADVERTISER_PROGRAM.amountCents),
      creditCents: programCreditCents(ADVERTISER_PROGRAM.amountCents),
      cardFeeRate: ADVERTISER_PROGRAM.cardFeeRate,
      // What a member pays per lead today (cost per lead + card fee), per source campaign.
      leadPriceCents: { low: programLeadPriceCents(Math.min(abca, ew)), high: programLeadPriceCents(Math.max(abca, ew)) },
    },
    member: live
      ? {
          status: live.status,
          startedAt: live.start_date ? new Date(live.start_date * 1000).toISOString() : null,
          nextPaymentAt: periodEnd(live) ? new Date(periodEnd(live) * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!live.cancel_at_period_end || !!live.cancel_at,
        }
      : null,
    joined: programSubs.some((s) => s.status !== "incomplete" && s.status !== "incomplete_expired"),
    legacyUntil: legacyUntil?.toISOString() ?? null,
    mustJoin: mustJoinProgram(user.email, programSubs),
    licensedStates: user.licensedStates ?? [],
    balance: summary
      ? { balanceCents: summary.balanceCents, leads: summary.leads, costPerLeadCents: summary.costPerLeadCents, errors: summary.errors.length > 0 }
      : null,
  });
}
