import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { getAdSpendSummary, isSharedPoolOnly } from "@/lib/adSpend";
import { uplineOwnerEmails } from "@/lib/teamAdvertiser";
import { sharedCplCents } from "@/lib/sharedPool";
import {
  ADVERTISER_PROGRAM,
  FEE_WAIVER,
  programLeadPriceCents,
  legacyCoverEnds,
  mustJoinProgram,
  waiverEnded,
  waivedSavingsCents,
} from "@/lib/advertiserProgram";
import {
  findProgramSubscriptions,
  isOnFeeWaiverTeam,
  syncProgramMember,
  waiveExistingMembership,
} from "@/lib/advertiserProgramBilling";

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

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, licensedStates: true, adCampaignIds: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [subs, onWaiverTeam] = await Promise.all([
    isStripeConfigured ? findProgramSubscriptions(userId, user.email).catch(() => []) : Promise.resolve([]),
    isOnFeeWaiverTeam(userId).catch(() => false),
  ]);
  await syncProgramMember(userId, subs).catch((e) => console.warn("[program] sync failed", (e as Error).message));

  // A waived membership counts only while they're on the team (FEE_WAIVER).
  const waived = (s: (typeof subs)[number]) => !!s.metadata?.feeWaived;
  const live = subs.find((s) => LIVE.has(s.status) && (!waived(s) || onWaiverTeam));
  // Someone on the Enhanced Wealth team who joined paying: waive it from their next payment on.
  if (live && onWaiverTeam && !waived(live)) {
    await waiveExistingMembership(live)
      .then(async () => { live.metadata = (await stripe!.subscriptions.retrieve(live.id)).metadata; })
      .catch((e) => console.warn("[program] waiving an existing membership failed", (e as Error).message));
  }
  const periodEnd = (s: any) => s.items?.data?.[0]?.current_period_end ?? s.current_period_end ?? null;
  const fresh = await prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true } });
  const summary = fresh?.isAdvertiser ? await getAdSpendSummary(userId, { fresh: true }).catch(() => null) : null;
  const programSubs = subs.map((s) => ({ program: true, status: s.status, feeWaived: waived(s) }));
  const [abca, ew] = await Promise.all([sharedCplCents("abca"), sharedCplCents("ew")]);
  const uplineEmails = await uplineOwnerEmails(userId);
  const cover = legacyCoverEnds(user.email, uplineEmails);

  return NextResponse.json({
    available: isStripeConfigured,
    offer: {
      name: ADVERTISER_PROGRAM.name,
      amountCents: ADVERTISER_PROGRAM.amountCents,
      intervalWeeks: ADVERTISER_PROGRAM.intervalWeeks,
      managementRate: ADVERTISER_PROGRAM.managementRate,
      cardFeeRate: ADVERTISER_PROGRAM.cardFeeRate,
      // What a member pays per lead today (cost per lead + management fee + card fee), per source campaign.
      leadPriceCents: { low: programLeadPriceCents(Math.min(abca, ew)), high: programLeadPriceCents(Math.max(abca, ew)) },
    },
    // On the Enhanced Wealth team the membership is waived; the page shows it.
    feeWaiver: onWaiverTeam ? { label: FEE_WAIVER.label } : null,
    member: live
      ? {
          status: live.status,
          startedAt: live.start_date ? new Date(live.start_date * 1000).toISOString() : null,
          nextPaymentAt: periodEnd(live) ? new Date(periodEnd(live) * 1000).toISOString() : null,
          cancelAtPeriodEnd: !!live.cancel_at_period_end || !!live.cancel_at,
          feeWaived: waived(live),
          // Membership fees they haven't paid since joining on a waived membership.
          savedCents: waived(live)
            ? waivedSavingsCents(live.metadata?.feeWaivedAt ?? (live.start_date ? new Date(live.start_date * 1000) : null))
            : 0,
        }
      : null,
    waiverEnded: waiverEnded(programSubs, { onWaiverTeam }),
    joined: programSubs.some((s) => s.status !== "incomplete" && s.status !== "incomplete_expired"),
    legacyUntil: cover?.ends.toISOString() ?? null,
    legacyViaTeam: cover?.viaTeam ?? false,
    mustJoin: mustJoinProgram(user.email, programSubs, new Date(), {
      uplineEmails,
      onWaiverTeam,
      sharedPoolOnly: isSharedPoolOnly(user.adCampaignIds),
    }),
    licensedStates: user.licensedStates ?? [],
    balance: summary
      ? { balanceCents: summary.balanceCents, leads: summary.leads, costPerLeadCents: summary.costPerLeadCents, errors: summary.errors.length > 0 }
      : null,
  });
}
