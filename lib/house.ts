import { prisma } from "./prisma";
import { IUL_POOL_IDS } from "@/data/packages";

/**
 * The "house" account — the platform admin's own CRM (Ryan). Any lead whose
 * state no active order covers is routed here instead of sitting unassigned in
 * the pool, so his team works it while it's fresh. Resolved by role rather than
 * a hard-coded email; falls back to null if no admin exists.
 */
export async function getHouseAccount(): Promise<{ userId: string; organizationId: string | null } | null> {
  if (!prisma) return null;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, ownedOrganizations: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!admin) return null;
  return { userId: admin.id, organizationId: admin.ownedOrganizations[0]?.id ?? null };
}

/**
 * The set of states an incoming lead could still be delivered into — i.e. the
 * union of filterStates across all OPEN orders (an empty filterStates = all
 * states, so such an order makes every state "covered"). A lead whose state is
 * not in this set has no buyer and belongs to the house.
 */
export async function coveredStates(): Promise<{ states: Set<string>; anyStateOrder: boolean }> {
  if (!prisma) return { states: new Set(), anyStateOrder: false };
  const open = await prisma.order.findMany({
    where: { status: { in: ["PENDING", "PROCESSING", "DELIVERING"] } },
    select: { filterStates: true },
  });
  const states = new Set<string>();
  let anyStateOrder = false;
  for (const o of open) {
    if (o.filterStates.length === 0) anyStateOrder = true;
    o.filterStates.forEach((s) => states.add(s));
  }
  return { states, anyStateOrder };
}

/**
 * Assign one lead to the house CRM (unassigned/orphaned → Ryan). No delivery
 * email — this is an internal hand-off, not a client fulfillment. Guarded on
 * assignedUserId:null so it never steals a lead an order just claimed.
 */
export async function assignLeadToHouse(leadId: string, reason: string): Promise<boolean> {
  if (!prisma) return false;
  const house = await getHouseAccount();
  if (!house) return false;
  const now = new Date();
  const res = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: house.userId,
      assignedAt: now,
      ...(house.organizationId ? { organizationId: house.organizationId } : {}),
    },
  });
  if (res.count > 0) {
    await prisma.leadActivity.create({
      data: { leadId, type: "LEAD_ASSIGNED", body: `Routed to house CRM — ${reason}.` },
    });
    return true;
  }
  return false;
}

/**
 * Backfill: sweep every unassigned pool lead whose state no open order covers
 * into the house CRM. Leaves states with active demand alone (their inventory
 * still serves those orders + the aged store). Returns what moved.
 */
export async function sweepOrphansToHouse(): Promise<{
  moved: number;
  byState: Record<string, number>;
  skippedCoveredStates: string[];
}> {
  if (!prisma) return { moved: 0, byState: {}, skippedCoveredStates: [] };
  const house = await getHouseAccount();
  if (!house) return { moved: 0, byState: {}, skippedCoveredStates: [] };

  const { states: covered, anyStateOrder } = await coveredStates();
  // An open "all states" order means nothing is orphaned.
  if (anyStateOrder) return { moved: 0, byState: {}, skippedCoveredStates: [...covered] };

  const pool = await prisma.lead.findMany({
    where: {
      packageId: { in: IUL_POOL_IDS },
      assignedUserId: null,
      orderId: null,
      trashedAt: null,
    },
    select: { id: true, state: true },
  });

  const orphans = pool.filter((l) => l.state && !covered.has(l.state));
  const now = new Date();
  const byState: Record<string, number> = {};

  // Move in one updateMany per state batch for efficiency, then log activity.
  const ids = orphans.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await prisma.lead.updateMany({
      where: { id: { in: chunk }, assignedUserId: null },
      data: {
        assignedUserId: house.userId,
        assignedAt: now,
        ...(house.organizationId ? { organizationId: house.organizationId } : {}),
      },
    });
    await prisma.leadActivity.createMany({
      data: chunk.map((leadId) => ({
        leadId,
        type: "LEAD_ASSIGNED" as const,
        body: "Routed to house CRM — no active order covers this state.",
      })),
    });
  }
  for (const l of orphans) byState[l.state] = (byState[l.state] ?? 0) + 1;

  return { moved: orphans.length, byState, skippedCoveredStates: [...covered].sort() };
}
