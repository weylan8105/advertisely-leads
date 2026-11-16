import { prisma } from "./prisma";
import { SHARED_POOL_ONLY, forgetAdSpendSummary } from "./adSpend";
import { LEGACY_TEAM_ADVERTISER_OWNERS, legacyRetainerEnds } from "./advertiserProgram";

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
