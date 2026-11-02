import { prisma } from "./prisma";

/**
 * Weekly amounts (Organization.distributionMode = WEEKLY_QUOTA).
 *
 * The team owner sets how many leads each agent gets per rolling 7 days
 * (Membership.weeklyLeadQuota), e.g. 20 for one agent and 100 for another.
 * Leads that land in the OWNER's pipeline (their own lead orders and their
 * admin overflow) go to the agent furthest behind their number, by share
 * filled, so a 100/wk agent gets about five times what a 20/wk agent gets. Only
 * agents licensed in the lead's state qualify (no states on file = all states,
 * the same fallback buyers get). Once every agent is full for the week, the
 * rest stay with the owner. Routed leads are stamped Lead.quotaRoutedAt, which
 * is what "this week" counts.
 */

export const QUOTA_WINDOW_MS = 7 * 86_400_000;
export const MAX_WEEKLY_QUOTA = 1000;

export interface QuotaSlot {
  userId: string;
  quota: number;
  got: number;
  licensedStates: string[];
}

/** How many quota-routed leads each of these agents got from the team in the last 7 days. */
export async function quotaCountsThisWeek(
  organizationId: string,
  userIds: string[],
  now = Date.now(),
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!prisma || userIds.length === 0) return out;
  const rows = await prisma.lead.groupBy({
    by: ["assignedUserId"],
    where: {
      organizationId,
      assignedUserId: { in: userIds },
      quotaRoutedAt: { gte: new Date(now - QUOTA_WINDOW_MS) },
      trashedAt: null,
    },
    _count: { _all: true },
  });
  for (const r of rows) if (r.assignedUserId) out.set(r.assignedUserId, r._count._all);
  return out;
}

/** The team's agents with a weekly amount, and how far into it they are. Never includes the owner. */
export async function loadQuotaSlots(organizationId: string, ownerId: string, now = Date.now()): Promise<QuotaSlot[]> {
  if (!prisma) return [];
  const members = await prisma.membership.findMany({
    where: { organizationId, userId: { not: ownerId }, weeklyLeadQuota: { gt: 0 } },
    select: { userId: true, weeklyLeadQuota: true, user: { select: { licensedStates: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (members.length === 0) return [];
  const got = await quotaCountsThisWeek(organizationId, members.map((m) => m.userId), now);
  return members.map((m) => ({
    userId: m.userId,
    quota: m.weeklyLeadQuota ?? 0,
    got: got.get(m.userId) ?? 0,
    licensedStates: m.user.licensedStates ?? [],
  }));
}

/**
 * Pick the agent for one lead and count it against their week. Null = nobody
 * has room (or is licensed in that state), so the lead stays with the owner.
 */
export function takeQuotaSlot(slots: QuotaSlot[], state: string): string | null {
  let best: QuotaSlot | null = null;
  for (const s of slots) {
    if (s.got >= s.quota) continue;
    if (s.licensedStates.length > 0 && !s.licensedStates.includes(state)) continue;
    if (!best || s.got / s.quota < best.got / best.quota) best = s;
  }
  if (!best) return null;
  best.got++;
  return best.userId;
}

/** Who should get one lead arriving in this owner's pipeline: an agent with room, or null to keep it. */
export async function quotaRecipientFor(
  organizationId: string | null,
  ownerId: string,
  state: string,
): Promise<string | null> {
  if (!prisma || !organizationId) return null;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ownerId: true, distributionMode: true },
  });
  if (!org || org.distributionMode !== "WEEKLY_QUOTA" || org.ownerId !== ownerId) return null;
  return takeQuotaSlot(await loadQuotaSlots(organizationId, ownerId), state);
}
