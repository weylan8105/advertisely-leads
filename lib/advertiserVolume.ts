import { prisma } from "./prisma";
import { loadQuotaSlots, takeQuotaSlot } from "./teamQuota";

/**
 * Advertiser weekly volume (User.advertiserWeeklyKeep).
 *
 * An advertiser owns every lead their campaign produces, but can choose how
 * many they personally keep per rolling 7 days, down to 0, so their team eats
 * instead. Mirrors the admin overflow target (lib/house.ts). Once they've kept
 * their amount, each new campaign lead goes to a team member:
 *  - team on "Weekly amounts" → the agent furthest behind their weekly number
 *  - otherwise → round-robin across approved, in-rotation teammates
 * Only agents licensed in the lead's state qualify (no states on file = all).
 * If nobody on the team can take it, the advertiser keeps it — a lead is never
 * left unassigned.
 */

export const ADVERTISER_WINDOW_MS = 7 * 86_400_000;
export const MAX_ADVERTISER_KEEP = 100_000;

/** Campaign leads the advertiser kept in their own pipeline in the rolling week. */
export async function advertiserKeptLeads(ownerId: string, now = Date.now()): Promise<Date[]> {
  if (!prisma) return [];
  const rows = await prisma.lead.findMany({
    where: {
      assignedUserId: ownerId,
      orderId: null, // owner-delivered, not order-fulfilled purchases
      quotaRoutedAt: null,
      trashedAt: null,
      assignedAt: { gte: new Date(now - ADVERTISER_WINDOW_MS) },
    },
    orderBy: { assignedAt: "asc" },
    select: { assignedAt: true },
  });
  return rows.map((r) => r.assignedAt!).filter(Boolean);
}

/** Kept count + (when at/over) when enough leads age out to start keeping again. */
export async function advertiserUsage(
  ownerId: string,
  keep: number | null,
): Promise<{ kept7d: number; resumesAt: string | null }> {
  const kept = await advertiserKeptLeads(ownerId);
  let resumesAt: string | null = null;
  if (keep && kept.length >= keep) {
    const t = kept[kept.length - keep];
    if (t) resumesAt = new Date(t.getTime() + ADVERTISER_WINDOW_MS).toISOString();
  }
  return { kept7d: kept.length, resumesAt };
}

/**
 * Who on the advertiser's team should get this lead instead of them, or null
 * to keep it (no amount set, still under it, or no teammate can take it).
 */
export async function advertiserTeamRecipient(
  ownerId: string,
  organizationId: string | null,
  state: string,
): Promise<{ userId: string; byQuota: boolean } | null> {
  if (!prisma || !organizationId) return null;
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { advertiserWeeklyKeep: true } });
  const keep = owner?.advertiserWeeklyKeep;
  if (keep === null || keep === undefined) return null;
  if (keep > 0 && (await advertiserKeptLeads(ownerId)).length < keep) return null;

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      ownerId: true,
      distributionMode: true,
      rrCursor: true,
      memberships: {
        where: { userId: { not: ownerId }, inRotation: true, pendingApproval: false },
        select: { userId: true, user: { select: { licensedStates: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  // Only the team the advertiser owns; a member's own campaign stays theirs.
  if (!org || org.ownerId !== ownerId) return null;

  if (org.distributionMode === "WEEKLY_QUOTA") {
    const agent = takeQuotaSlot(await loadQuotaSlots(organizationId, ownerId), state);
    if (agent) return { userId: agent, byQuota: true };
  }

  const pool = org.memberships.filter((m) => {
    const states = m.user.licensedStates ?? [];
    return states.length === 0 || states.includes(state);
  });
  if (pool.length === 0) return null;
  const pick = pool[org.rrCursor % pool.length];
  await prisma.organization.update({
    where: { id: organizationId },
    data: { rrCursor: (org.rrCursor + 1) % 1_000_000 },
  });
  return { userId: pick.userId, byQuota: false };
}
