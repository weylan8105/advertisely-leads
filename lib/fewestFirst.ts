import { prisma } from "./prisma";

/**
 * Fewest first (owner, Nov 23 2026): a new lead goes to whichever person in its
 * rotation has received the fewest leads in the last 24 hours, so nobody is
 * starved while others are on pace.
 *
 * Why: every state keeps its own turn order and nothing tracked how many leads a
 * person had overall. Someone licensed in many states stood in many lines at
 * once and got many leads; someone in a few quiet states could wait all day.
 *
 * The turn order still decides ties: among people level on leads, the one next
 * in that state's line goes first, exactly as before. Everyone in the rotation
 * is counted the same way, the admins' turn included (owner: Ryan is not put
 * last, and not put first).
 *
 * It only changes who is asked first. Who is in the rotation at all (state,
 * lead type, budget, pauses, weekly caps) is decided before this runs, and a
 * slot that can't take the lead is still skipped for the next one.
 *
 * TO TURN OFF: set `enabled: false` and deploy; the plain turn order returns.
 */
export const FEWEST_FIRST = {
  enabled: true,
  windowHours: 24,
};

/**
 * The order to offer a lead in. `turnOrder` is the rotation starting with
 * whoever is next in line; `received` is each person's leads in the window
 * (missing = 0). Fewest first, the turn order breaking ties.
 */
export function fewestFirstOrder(turnOrder: string[], received: Map<string, number>): string[] {
  return turnOrder
    .map((id, i) => ({ id, i, n: received.get(id) ?? 0 }))
    .sort((a, b) => a.n - b.n || a.i - b.i)
    .map((x) => x.id);
}

/**
 * How many leads each of these people has received in the window: every lead
 * assigned to them, whatever it came from (shared pool, an order, their own
 * campaign, their team Goldmine). The same count Lead Pace shows. If it can't
 * be read the map is empty, which leaves the plain turn order.
 */
export async function leadsReceivedRecently(userIds: string[], now = new Date()): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!prisma || userIds.length === 0) return out;
  try {
    const since = new Date(now.getTime() - FEWEST_FIRST.windowHours * 3_600_000);
    const rows = await prisma.lead.groupBy({
      by: ["assignedUserId"],
      where: { assignedUserId: { in: userIds }, assignedAt: { gte: since }, trashedAt: null },
      _count: { _all: true },
    });
    for (const r of rows) if (r.assignedUserId) out.set(r.assignedUserId, r._count._all);
  } catch (e) {
    console.warn("[fewest first] count failed; using the plain turn order", e);
  }
  return out;
}
