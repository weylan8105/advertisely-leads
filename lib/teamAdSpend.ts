import { prisma } from "./prisma";
import type { ClientPayment } from "./adSpend";

/**
 * Team ad spend: an advertiser's downlines add money to the advertiser's own
 * campaign and get campaign leads for it.
 *
 *  - The upline switches it on per member (Membership.adSpendAccess, off by
 *    default). It only covers paid campaign leads; the free round robin /
 *    weekly amounts of the advertiser's own leads (lib/advertiserVolume.ts)
 *    don't change.
 *  - What a downline pays (after the 3% card fee) funds the campaign: it counts
 *    in the advertiser's budget and pacing (lib/adSpend.ts) and becomes the
 *    downline's credit (TeamAdSpend ledger).
 *  - Each campaign lead rotates between the advertiser and every downline with
 *    access, enough credit for one lead, and a license in the lead's state
 *    (no states on file = all). Whoever went longest without a campaign lead
 *    is next. A downline's lead takes the campaign's cost per lead at that
 *    moment from their credit; credit under one lead's cost waits for their
 *    next top-up.
 *  - The advertiser's turn goes through the usual advertiser routing.
 */

export const TEAM_AD_SPEND_KIND = "team-ad-spend"; // Stripe metadata.kind on downline top-ups
/**
 * Ledger kind for money a downline paid the advertiser directly (before team
 * funding existed, or off the site). It's credit like a "payment", but it is
 * NOT added to the advertiser's budget: the advertiser already paid it in
 * with their own ad-spend payments.
 */
export const DIRECT_PAYMENT_KIND = "direct-payment";
const PAID_KINDS = new Set(["payment", DIRECT_PAYMENT_KIND]);
const LAST_TURN_LOOKBACK_MS = 30 * 86_400_000;

/** Every downline's credit on this advertiser's campaign, in cents. */
export async function teamBalances(advertiserId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!prisma) return out;
  const rows = await prisma.teamAdSpend.groupBy({
    by: ["userId"],
    where: { advertiserId },
    _sum: { amountCents: true },
  });
  for (const r of rows) out.set(r.userId, r._sum.amountCents ?? 0);
  return out;
}

export interface TeamFunding {
  userId: string;
  name: string;
  addedCents: number; // charged, before card processing (direct payments included)
  directCents: number; // part of addedCents they paid the advertiser directly
  creditAddedCents: number; // after card processing
  leads: number;
  leadCostCents: number;
  creditCents: number; // left
  access: boolean;
}

/** Per downline: what they added, leads they got, credit left. */
export async function teamFunding(advertiserId: string): Promise<TeamFunding[]> {
  if (!prisma) return [];
  const rows = await prisma.teamAdSpend.findMany({ where: { advertiserId } });
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.userId))];
  const [users, access] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }),
    prisma.membership.findMany({
      where: { userId: { in: ids }, adSpendAccess: true, organization: { ownerId: advertiserId } },
      select: { userId: true },
    }),
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  const on = new Set(access.map((a) => a.userId));
  return ids
    .map((userId) => {
      const mine = rows.filter((r) => r.userId === userId);
      const leads = mine.filter((r) => r.kind === "lead");
      const paid = mine.filter((r) => PAID_KINDS.has(r.kind));
      return {
        userId,
        name: nameOf.get(userId) ?? "Former member",
        addedCents: paid.reduce((s, r) => s + (r.grossCents ?? r.amountCents), 0),
        directCents: paid.filter((r) => r.kind === DIRECT_PAYMENT_KIND).reduce((s, r) => s + r.amountCents, 0),
        creditAddedCents: paid.reduce((s, r) => s + r.amountCents, 0),
        leads: leads.length,
        leadCostCents: -leads.reduce((s, r) => s + r.amountCents, 0),
        creditCents: mine.reduce((s, r) => s + r.amountCents, 0),
        access: on.has(userId),
      };
    })
    .sort((a, b) => b.addedCents - a.addedCents);
}

/**
 * Downline payments into this advertiser's campaign, as budget payments.
 * Direct payments are left out: that money is already in the advertiser's own payments.
 */
export async function teamFundingPayments(advertiserId: string): Promise<ClientPayment[]> {
  if (!prisma) return [];
  const rows = await prisma.teamAdSpend.findMany({
    where: { advertiserId, kind: "payment" },
    orderBy: { createdAt: "desc" },
  });
  if (!rows.length) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
    select: { id: true, name: true, email: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name?.trim() || u.email]));
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    amountCents: r.grossCents ?? r.amountCents,
    description: `Added by ${nameOf.get(r.userId) ?? "a team member"}`,
    method: "team",
    processingFeeCents: r.processingFeeCents,
  }));
}

/** Record a downline's paid top-up. Idempotent on the Stripe reference. */
export async function recordTeamPayment(p: {
  advertiserId: string;
  userId: string;
  grossCents: number;
  processingFeeCents: number;
  stripeRef: string;
}): Promise<boolean> {
  if (!prisma || p.grossCents <= 0) return false;
  try {
    await prisma.teamAdSpend.create({
      data: {
        advertiserId: p.advertiserId,
        userId: p.userId,
        kind: "payment",
        amountCents: p.grossCents - p.processingFeeCents,
        grossCents: p.grossCents,
        processingFeeCents: p.processingFeeCents,
        stripeRef: p.stripeRef,
      },
    });
    return true;
  } catch (e: any) {
    if (e?.code === "P2002") return false; // already recorded (webhook retry)
    throw e;
  }
}

/** The team the advertiser owns that this member may fund, or null. */
export async function fundableMembership(userId: string, advertiserId: string) {
  if (!prisma) return null;
  return prisma.membership.findFirst({
    where: { userId, adSpendAccess: true, organization: { ownerId: advertiserId, owner: { isAdvertiser: true } } },
    select: { id: true, organizationId: true },
  });
}

/** Cheap pre-check before the CPL lookup: does anyone on the team have credit to spend? */
export async function teamHasFundedMembers(advertiserId: string, organizationId: string): Promise<boolean> {
  if (!prisma) return false;
  const balances = await teamBalances(advertiserId);
  if (![...balances.values()].some((c) => c > 0)) return false;
  const n = await prisma.membership.count({
    where: { organizationId, adSpendAccess: true, userId: { in: [...balances.keys()] } },
  });
  return n > 0;
}

const licensedFor = (states: string[] | null | undefined, state: string) =>
  !states || states.length === 0 || states.includes(state);

/**
 * Whose turn this campaign lead is: a funded downline's id, or null for the
 * advertiser's turn (or nobody else can take it).
 */
export async function fundedTeamRecipient(
  advertiserId: string,
  organizationId: string,
  state: string,
  cplCents: number,
  advertiserLabel: string,
  now = Date.now(),
): Promise<string | null> {
  if (!prisma || cplCents <= 0) return null;
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { ownerId: true } });
  if (!org || org.ownerId !== advertiserId) return null;

  const [members, balances] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId, adSpendAccess: true, role: { not: "OWNER" }, userId: { not: advertiserId } },
      select: { userId: true, user: { select: { licensedStates: true } } },
    }),
    teamBalances(advertiserId),
  ]);
  const eligible = members
    .filter((m) => (balances.get(m.userId) ?? 0) >= cplCents && licensedFor(m.user.licensedStates, state))
    .map((m) => m.userId);
  if (!eligible.length) return null;

  // Least recently served goes next.
  const since = new Date(now - LAST_TURN_LOOKBACK_MS);
  const last = await prisma.teamAdSpend.groupBy({
    by: ["userId"],
    where: { advertiserId, kind: "lead", userId: { in: eligible } },
    _max: { createdAt: true },
  });
  const lastOf = new Map(last.map((r) => [r.userId, r._max.createdAt?.getTime() ?? 0]));
  // The advertiser's turns: campaign leads that weren't paid for by a downline.
  const ownerRows = await prisma.$queryRaw<{ at: Date | null }[]>`
    SELECT max(l."assignedAt") AS at
    FROM "Lead" l
    WHERE l."rawFormData"->>'advertiser_name' = ${advertiserLabel}
      AND l."assignedAt" >= ${since}
      AND NOT EXISTS (SELECT 1 FROM "TeamAdSpend" t WHERE t."leadId" = l.id)`;
  const ownerLast = ownerRows[0]?.at ? new Date(ownerRows[0].at).getTime() : 0;

  // Downlines first in the list, so a tie (nobody served yet) favors them.
  const turns = [...eligible.map((id) => ({ id, at: lastOf.get(id) ?? 0 })), { id: advertiserId, at: ownerLast }];
  const next = turns.reduce((a, b) => (b.at < a.at ? b : a));
  return next.id === advertiserId ? null : next.id;
}

/**
 * Give the lead to a funded downline and take one lead's cost from their
 * credit, together, or neither. False when the lead was taken or their credit
 * ran short in the meantime.
 */
export async function assignFundedLead(p: {
  leadId: string;
  advertiserId: string;
  userId: string;
  cplCents: number;
  leadData: Record<string, unknown>;
}): Promise<boolean> {
  if (!prisma) return false;
  try {
    return await prisma.$transaction(async (tx) => {
      const bal = await tx.teamAdSpend.aggregate({
        where: { advertiserId: p.advertiserId, userId: p.userId },
        _sum: { amountCents: true },
      });
      if ((bal._sum.amountCents ?? 0) < p.cplCents) return false;
      const res = await tx.lead.updateMany({
        where: { id: p.leadId, assignedUserId: null, trashedAt: null },
        data: { ...p.leadData, assignedUserId: p.userId },
      });
      if (res.count === 0) return false;
      await tx.teamAdSpend.create({
        data: {
          advertiserId: p.advertiserId,
          userId: p.userId,
          kind: "lead",
          amountCents: -p.cplCents,
          cplCents: p.cplCents,
          leadId: p.leadId,
        },
      });
      return true;
    });
  } catch (e) {
    console.warn("[teamAdSpend] funded assignment failed", e);
    return false;
  }
}
