/**
 * Each ad-spend deposit is its own order (owner request, Nov 19 2026), so a
 * client's budget reads like lead orders instead of one running total that
 * keeps growing: spend fills the oldest order first. When an order has less
 * left than one lead costs, it's complete and the leftover carries into the
 * next deposit (shown on both, so the money never looks like it disappeared).
 * Display only: the balance, pacing and lead routing are unchanged.
 * Client-safe: no server imports.
 */

export type AdSpendOrderStatus = "complete" | "active" | "queued";

export interface AdSpendOrder {
  n: number; // 1 = their first deposit
  paymentId: string;
  at: string; // ISO
  method: string;
  description: string | null;
  paidCents: number; // before card processing
  netCents: number; // after card processing
  carriedInCents: number; // leftover from the order before
  budgetCents: number; // net + carried in
  spentCents: number;
  leftCents: number; // budget − spent (negative = over)
  carriedOutCents: number; // leftover passed to the next deposit (or waiting for it)
  status: AdSpendOrderStatus;
}

export interface OrderPayment {
  id: string;
  at: string;
  amountCents: number;
  processingFeeCents: number;
  method: string;
  description: string | null;
}

/** What an order needs left to still get a lead, when the real cost isn't known yet. */
export const FALLBACK_LEAD_COST_CENTS = 2000;

/**
 * Split the client's deposits into orders. `consumedCents` is everything that
 * has come out of the budget (spend, fees, shared leads, moved-out credit), so
 * the orders' leftovers always add up to their balance.
 */
export function adSpendOrders(payments: OrderPayment[], consumedCents: number, leadCostCents: number | null): AdSpendOrder[] {
  const threshold = leadCostCents && leadCostCents > 0 ? leadCostCents : FALLBACK_LEAD_COST_CENTS;
  const deposits = payments.filter((p) => p.amountCents > 0).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  let toAllocate = Math.max(0, consumedCents);
  let carry = 0;
  let activeFound = false;
  return deposits.map((p, i) => {
    const netCents = p.amountCents - p.processingFeeCents;
    const carriedInCents = carry;
    const budgetCents = netCents + carriedInCents;
    const last = i === deposits.length - 1;
    // The last order takes any overdraw, so nothing spent goes missing.
    const spentCents = activeFound ? 0 : last ? toAllocate : Math.min(budgetCents, toAllocate);
    toAllocate -= spentCents;
    const leftCents = budgetCents - spentCents;
    let status: AdSpendOrderStatus;
    let carriedOutCents = 0;
    if (activeFound) {
      status = "queued";
    } else if (leftCents >= threshold) {
      status = "active";
      activeFound = true;
    } else {
      status = "complete";
      carriedOutCents = Math.max(0, leftCents);
    }
    carry = status === "complete" ? carriedOutCents : 0;
    return {
      n: i + 1,
      paymentId: p.id,
      at: p.at,
      method: p.method,
      description: p.description,
      paidCents: p.amountCents,
      netCents,
      carriedInCents,
      budgetCents,
      spentCents,
      leftCents,
      carriedOutCents,
      status,
    };
  });
}

/** The order to show at a glance: the one being filled now, else the latest. */
export function currentOrder(orders: AdSpendOrder[] | undefined): AdSpendOrder | null {
  if (!orders?.length) return null;
  return orders.find((o) => o.status === "active") ?? orders[orders.length - 1];
}
