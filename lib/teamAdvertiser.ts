import { prisma } from "./prisma";
import { SHARED_POOL_ONLY, forgetAdSpendSummary } from "./adSpend";
import { LEGACY_TEAM_ADVERTISER_OWNERS, legacyRetainerEnds } from "./advertiserProgram";
import { HOUSE_EMAIL } from "./housePause";
import { MOVED_OUT_KIND, DIRECT_PAYMENT_KIND } from "./teamAdSpend";

// ─── Team members who advertise under their upline's November fee ───────────
// Owner directive (Nov 16 2026), for Jace's team: someone who joins it starts
// with Goldmine off and as an advertiser on the shared pool, buying their own
// leads by adding ad spend. It lasts as long as the upline's November fee
// (LEGACY_RETAINER_UNTIL in lib/advertiserProgram.ts). From that date nobody
// new gets these defaults, and everyone on the team needs the Advertiser
// Program for leads, like the upline does (mustJoinProgram).

const norm = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** Is this team's owner one whose members advertise under their fee, and is that fee still running? */
export function teamAdvertiserActive(ownerEmail: string | null | undefined, now = new Date()): boolean {
  if (!LEGACY_TEAM_ADVERTISER_OWNERS.has(norm(ownerEmail))) return false;
  const ends = legacyRetainerEnds(ownerEmail);
  return !!ends && now < ends;
}

/**
 * On these teams a member's ad spend is always their own (owner, Nov 16 2026):
 * it never goes into the owner's campaign or onto the owner's account, before
 * or after the owner's fee runs out. So the "add spend to your upline's
 * campaign" path (lib/teamAdSpend.ts) is closed for them.
 */
export function membersFundThemselves(ownerEmail: string | null | undefined): boolean {
  return LEGACY_TEAM_ADVERTISER_OWNERS.has(norm(ownerEmail));
}

/**
 * Why money a member adds to this upline's campaign could never buy a lead, or
 * null when it can. A member's credit is only spent when a lead from the
 * upline's OWN campaign is delivered to the upline (deliverLeadToOwner in
 * lib/house.ts gives the member their turn). So the "add spend to your
 * upline's campaign" path is closed when:
 *  - "members-fund-themselves": on that team a member's spend is their own;
 *  - "house": the upline is the house (Ryan). His leads come from his turn in
 *    the round robin, which never looks at team credit;
 *  - "shared-pool-only": the upline has no campaign of their own. Shared-pool
 *    leads are paid from the client's own balance, never a downline's credit;
 *  - "not-advertiser": the upline isn't an advertiser at all.
 * Owner, Nov 19 2026, after a member paid $250 into Ryan's campaign and got no
 * leads for it: "This should never happen again."
 */
export type FundingClosedReason = "members-fund-themselves" | "house" | "shared-pool-only" | "not-advertiser";
export type UplineForFunding = { email?: string | null; isAdvertiser?: boolean | null; adCampaignIds?: string[] | null };

export function teamFundingClosedReason(upline: UplineForFunding | null | undefined): FundingClosedReason | null {
  if (!upline?.isAdvertiser) return "not-advertiser";
  if (membersFundThemselves(upline.email)) return "members-fund-themselves";
  if (norm(upline.email) === HOUSE_EMAIL) return "house";
  if ((upline.adCampaignIds ?? []).includes(SHARED_POOL_ONLY)) return "shared-pool-only";
  return null;
}

/** Can a member's money on this upline's campaign buy them leads? */
export const uplineCampaignFundable = (upline: UplineForFunding | null | undefined): boolean =>
  teamFundingClosedReason(upline) === null;

/** What the member is told when the path is closed. */
export const FUNDING_CLOSED_MESSAGE =
  "Your ad spend goes to your own account. Add it with the Add spend card on your dashboard.";

/**
 * A member paid through the "fund your upline's campaign" checkout for an
 * upline whose campaign can't deliver leads for it (teamFundingClosedReason:
 * a page left open, or a checkout already in flight). The money is theirs: credit their own ad-spend balance, less the
 * card fee, once per payment, and make sure they are set up as an advertiser.
 */
export async function creditOwnSpendFromTeamCheckout(p: {
  userId: string;
  grossCents: number;
  processingFeeCents: number;
  stripeRef: string;
  paidAt?: Date;
}): Promise<boolean> {
  if (!prisma || p.grossCents <= 0) return false;
  const ref = `team-checkout:${p.stripeRef}`;
  const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const recorded = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ref}))`;
    const existing = await tx.adSpendPayment.findFirst({ where: { userId: p.userId, note: { contains: ref } }, select: { id: true } });
    if (existing) return false;
    await tx.adSpendPayment.create({
      data: {
        userId: p.userId,
        amountCents: p.grossCents - p.processingFeeCents,
        method: "other",
        receivedAt: p.paidAt ?? new Date(),
        note: `Card payment of ${usd(p.grossCents)} less ${usd(p.processingFeeCents)} card processing, added to your own account [${ref}]`,
      },
    });
    return true;
  });
  const u = await prisma.user.findUnique({ where: { id: p.userId }, select: { isAdvertiser: true, adCampaignIds: true } });
  if (u && !u.isAdvertiser) {
    await prisma.user.update({
      where: { id: p.userId },
      data: { isAdvertiser: true, adCampaignIds: u.adCampaignIds.length ? u.adCampaignIds : [SHARED_POOL_ONLY] },
    });
  }
  forgetAdSpendSummary(p.userId);
  return recorded;
}

/**
 * Credit a member still holds on a campaign that can no longer deliver leads
 * for it (the upline is the house, or no longer runs a campaign of their own)
 * moves to the member's own ad-spend balance, and the upline's campaign budget
 * drops by the same amount ("moved-out", lib/teamAdSpend.ts). Their switch for
 * adding spend to that campaign goes off. Only card credit moves by itself:
 * with money paid to the upline directly in the mix, a person decides.
 * Returns the cents moved (0 = nothing to move). Safe to call again.
 */
export async function moveStrandedTeamCredit(p: { userId: string; advertiserId: string; advertiserName: string }): Promise<number> {
  if (!prisma) return 0;
  const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const key = `team-credit:${p.advertiserId}:${p.userId}`;
  const moved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const rows = await tx.teamAdSpend.findMany({
      where: { advertiserId: p.advertiserId, userId: p.userId },
      select: { kind: true, amountCents: true },
    });
    const credit = rows.reduce((s, r) => s + r.amountCents, 0);
    if (credit <= 0 || rows.some((r) => r.kind === DIRECT_PAYMENT_KIND)) return 0;
    const ref = `moved-out:${p.advertiserId}:${p.userId}:${Date.now()}`;
    await tx.teamAdSpend.create({
      data: { advertiserId: p.advertiserId, userId: p.userId, kind: MOVED_OUT_KIND, amountCents: -credit, stripeRef: ref },
    });
    await tx.adSpendPayment.create({
      data: {
        userId: p.userId,
        amountCents: credit,
        method: "other",
        receivedAt: new Date(),
        note: `Unused credit of ${usd(credit)} moved from ${p.advertiserName}'s campaign to your own account [${ref}]`,
      },
    });
    return credit;
  });
  if (moved <= 0) return 0;
  await prisma.membership.updateMany({
    where: { userId: p.userId, organization: { ownerId: p.advertiserId } },
    data: { adSpendAccess: false },
  });
  const u = await prisma.user.findUnique({ where: { id: p.userId }, select: { isAdvertiser: true, adCampaignIds: true } });
  if (u && !u.isAdvertiser) {
    await prisma.user.update({
      where: { id: p.userId },
      data: { isAdvertiser: true, adCampaignIds: u.adCampaignIds.length ? u.adCampaignIds : [SHARED_POOL_ONLY] },
    });
  }
  forgetAdSpendSummary(p.userId);
  forgetAdSpendSummary(p.advertiserId);
  return moved;
}

/** The owners of the teams this user is on (not their own), for mustJoinProgram's cover check. */
export async function uplineOwnerEmails(userId: string): Promise<string[]> {
  if (!prisma) return [];
  const rows = await prisma.membership.findMany({
    where: { userId, organization: { ownerId: { not: userId } } },
    select: { organization: { select: { owner: { select: { email: true } } } } },
  });
  return rows.map((r) => r.organization.owner?.email).filter((e): e is string => !!e);
}

/**
 * Someone just joined a team. On a team whose members advertise under the
 * owner's fee: Goldmine off for them, and they become an advertiser on the
 * shared pool (an existing advertiser keeps their campaigns). Returns whether
 * the defaults were applied. Never throws: a join must not fail over this.
 */
export async function applyTeamJoinDefaults(userId: string, organizationId: string): Promise<boolean> {
  if (!prisma) return false;
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ownerId: true, owner: { select: { email: true } } },
    });
    if (!org || org.ownerId === userId || !teamAdvertiserActive(org.owner?.email)) return false;
    await prisma.membership.updateMany({ where: { organizationId, userId }, data: { goldmineBlocked: true } });
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true, adCampaignIds: true } });
    if (u && !u.isAdvertiser) {
      await prisma.user.update({
        where: { id: userId },
        data: { isAdvertiser: true, adCampaignIds: u.adCampaignIds.length ? u.adCampaignIds : [SHARED_POOL_ONLY] },
      });
      forgetAdSpendSummary(userId);
    }
    return true;
  } catch (e) {
    console.warn("[team advertiser] join defaults failed", e);
    return false;
  }
}
