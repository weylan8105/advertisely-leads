import { describe, it, expect } from "vitest";
import { adSpendOrders, currentOrder } from "@/lib/adSpendOrders";
import { adSpendProgress } from "@/lib/adSpendProgress";

const pay = (id: string, at: string, amountCents: number, processingFeeCents = 0) => ({
  id, at, amountCents, processingFeeCents, method: "card", description: null,
});

describe("adSpendOrders", () => {
  it("fills the oldest deposit first and queues the rest", () => {
    const o = adSpendOrders([pay("b", "2026-11-10", 50000), pay("a", "2026-11-01", 50000)], 30000, 2800);
    expect(o.map((x) => [x.paymentId, x.status, x.spentCents, x.leftCents])).toEqual([
      ["a", "active", 30000, 20000],
      ["b", "queued", 0, 50000],
    ]);
  });

  it("completes an order with less than one lead left and carries the leftover into the next", () => {
    const o = adSpendOrders([pay("a", "2026-11-01", 50000), pay("b", "2026-11-10", 50000)], 49000, 2800);
    expect(o[0]).toMatchObject({ status: "complete", leftCents: 1000, carriedOutCents: 1000 });
    expect(o[1]).toMatchObject({ status: "active", carriedInCents: 1000, budgetCents: 51000, spentCents: 0 });
    expect(currentOrder(o)?.paymentId).toBe("b");
  });

  it("spends a carried leftover as part of the next order", () => {
    const o = adSpendOrders([pay("a", "2026-11-01", 50000), pay("b", "2026-11-10", 50000)], 60000, 2800);
    expect(o[0]).toMatchObject({ status: "complete", spentCents: 50000, carriedOutCents: 0 });
    expect(o[1]).toMatchObject({ status: "active", spentCents: 10000, leftCents: 40000 });
  });

  it("keeps a last-order leftover waiting for the next deposit, and the leftovers add up to the balance", () => {
    const o = adSpendOrders([pay("a", "2026-11-01", 51546, 1546)], 48500, 2800);
    expect(o[0]).toMatchObject({ netCents: 50000, status: "complete", carriedOutCents: 1500 });
    const p = adSpendProgress({ availableCents: 50000, chargedCents: 48500, balanceCents: 1500, daysLeft: null, orders: o });
    expect(p).toMatchObject({ complete: true, out: false, low: false, spentCents: 48500, budgetCents: 50000 });
  });

  it("puts any overdraw on the last order", () => {
    const o = adSpendOrders([pay("a", "2026-11-01", 10000), pay("b", "2026-11-02", 10000)], 25000, 2000);
    expect(o[1]).toMatchObject({ spentCents: 15000, leftCents: -5000, status: "complete", carriedOutCents: 0 });
  });

  it("ignores negative payment rows as deposits and falls back to $20 with no lead cost", () => {
    const o = adSpendOrders([pay("a", "2026-11-01", 10000), pay("x", "2026-11-02", -3000)], 8500, null);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({ status: "complete", carriedOutCents: 1500 });
  });
});
