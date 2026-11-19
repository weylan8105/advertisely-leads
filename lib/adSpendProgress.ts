import type { AdSpendSummary } from "@/lib/adSpend";
import { currentOrder, type AdSpendOrder } from "@/lib/adSpendOrders";

/**
 * The ad spend bar, shared by the advertiser's own dashboard and the admin
 * Client accounts list so both always show the same numbers. Since Nov 19 2026
 * it tracks the current order (each deposit is one, lib/adSpendOrders.ts):
 * spent out of that deposit plus anything carried into it, instead of a
 * lifetime total that keeps growing. Client-safe: only types come from lib/adSpend.
 */
export function adSpendProgress(
  s: Pick<AdSpendSummary, "availableCents" | "chargedCents" | "balanceCents" | "daysLeft"> & { orders?: AdSpendOrder[] },
) {
  const order = currentOrder(s.orders);
  const spentCents = order ? order.spentCents : s.chargedCents;
  const budgetCents = order ? order.budgetCents : s.availableCents;
  const pct = budgetCents > 0 ? Math.min(100, Math.round((spentCents / budgetCents) * 100)) : 100;
  const out = s.balanceCents <= 0;
  // The order is done and only a leftover under one lead's cost is waiting for the next deposit.
  const complete = !!order && order.status === "complete";
  const low = !out && !complete && s.daysLeft !== null && s.daysLeft <= 3;
  return { pct, out, low, complete, order, spentCents, budgetCents, orderCount: s.orders?.length ?? 0 };
}
