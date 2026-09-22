import { prisma } from "./prisma";
import { findPackage } from "@/data/packages";

export interface OrderCriteria {
  filterStates: string[];
  filterAgeMinDays: number | null;
  filterAgeMaxDays: number | null;
  packageId: string;
}

/** A target user's currently-open orders (the criteria a lead must match). */
export async function activeOrdersFor(userId: string): Promise<OrderCriteria[]> {
  if (!prisma) return [];
  return prisma.order.findMany({
    where: { userId, status: { in: ["PENDING", "PROCESSING", "DELIVERING"] } },
    select: { filterStates: true, filterAgeMinDays: true, filterAgeMaxDays: true, packageId: true },
  });
}

/**
 * Does a lead match at least one of the given orders — same state + age-window
 * rules the automatic engine enforces? With NO orders there's nothing to
 * violate (a downline agent or the house account), so it returns ok.
 */
export function leadMatchesOrders(
  lead: { state: string | null; receivedAt: Date | null },
  orders: OrderCriteria[],
): { ok: boolean; reason?: string } {
  if (orders.length === 0) return { ok: true };
  const dayMs = 86_400_000;
  const ageDays = lead.receivedAt ? (Date.now() - new Date(lead.receivedAt).getTime()) / dayMs : null;

  for (const o of orders) {
    const stateOk = o.filterStates.length === 0 || (!!lead.state && o.filterStates.includes(lead.state));
    if (!stateOk) continue;
    const pk = findPackage(o.packageId);
    const maxD = o.filterAgeMaxDays ?? pk?.ageMaxDays ?? null;
    const minD = o.filterAgeMinDays ?? pk?.ageMinDays ?? null;
    let ageOk = true;
    if (ageDays != null) {
      if (maxD != null && ageDays > maxD) ageOk = false;
      if (minD != null && ageDays < minD) ageOk = false;
    }
    if (ageOk) return { ok: true };
  }

  const allStates = [...new Set(orders.flatMap((o) => o.filterStates))];
  return {
    ok: false,
    reason: `${lead.state ?? "?"}${ageDays != null ? ` / ${Math.round(ageDays)}d old` : ""} doesn't match the recipient's active order (states: ${allStates.join(", ") || "any"})`,
  };
}

/**
 * Convenience: fetch the user's active orders and test one lead — used by the
 * single-lead assign route. Never hands a client (someone with an order) a lead
 * outside their order's states/age window.
 */
export async function leadMatchesActiveOrder(
  userId: string,
  lead: { state: string | null; receivedAt: Date | null; packageId: string },
): Promise<{ ok: boolean; reason?: string }> {
  const orders = await activeOrdersFor(userId);
  return leadMatchesOrders(lead, orders);
}
