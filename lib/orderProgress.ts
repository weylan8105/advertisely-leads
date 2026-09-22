import { prisma } from "./prisma";

/**
 * Live delivered count per order — the number of non-trashed leads actually
 * attached to each order right now. Use this for progress bars instead of the
 * stored `fulfilledCount`, so the number can never drift from reality (it stays
 * correct no matter how leads were added, removed, or reassigned).
 */
export async function deliveredCounts(orderIds: string[]): Promise<Record<string, number>> {
  if (!prisma || orderIds.length === 0) return {};
  const groups = await prisma.lead.groupBy({
    by: ["orderId"],
    where: { orderId: { in: orderIds }, trashedAt: null },
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const g of groups) if (g.orderId) out[g.orderId] = g._count._all;
  return out;
}
