import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Subscribe & Save was replaced by the Advertiser Program: a subscription ends
 * with its last minimum week instead of renewing (lib/leadSubscription.ts).
 * SYNTHETIC data, mocked prisma and Stripe.
 */
const rows: any[] = [];
const db = {
  leadSubscription: {
    findMany: vi.fn(async () => rows.filter((r) => r.status !== "canceled" && !r.cancelAt)),
    update: vi.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
  },
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
const update = vi.fn();
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: true, stripe: { subscriptions: { update: (...a: unknown[]) => update(...a) } } }));
vi.mock("@/lib/fulfillment", () => ({ fulfillOrder: vi.fn() }));

const { endSubscriptionAfterMinimum, endDueSubscriptions } = await import("@/lib/leadSubscription");

const END = 1_795_000_000; // the paid week's end
const row = (o: Record<string, unknown> = {}) => ({ id: "s1", stripeSubscriptionId: "sub_1", status: "active", weeksBilled: 4, minWeeks: 4, cancelAt: null, ...o });

beforeEach(() => {
  rows.length = 0;
  vi.clearAllMocks();
  // Newer API shape: the period end is on the item, and cancel_at isn't set.
  update.mockResolvedValue({ cancel_at: null, cancel_at_period_end: true, items: { data: [{ current_period_end: END }] } });
});

describe("a lead subscription ends after its minimum", () => {
  it("4 of 4 paid: stops renewing at the end of the paid week", async () => {
    rows.push(row());
    const when = await endSubscriptionAfterMinimum(rows[0]);
    expect(update).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(when?.getTime()).toBe(END * 1000);
    expect(rows[0].cancelAt?.getTime()).toBe(END * 1000);
  });

  it("still inside the minimum, already ending, or cancelled: left alone", async () => {
    expect(await endSubscriptionAfterMinimum(row({ weeksBilled: 3 }))).toBeNull();
    expect(await endSubscriptionAfterMinimum(row({ cancelAt: new Date() }))).toBeNull();
    expect(await endSubscriptionAfterMinimum(row({ status: "canceled" }))).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("the catch-up only touches subscriptions that have paid their minimum, once", async () => {
    rows.push(row({ id: "a", stripeSubscriptionId: "sub_a" }), row({ id: "b", stripeSubscriptionId: "sub_b", weeksBilled: 2 }));
    expect(await endDueSubscriptions()).toBe(1);
    expect(await endDueSubscriptions()).toBe(0);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("sub_a", { cancel_at_period_end: true });
  });

  it("a Stripe failure never breaks the page that ran the catch-up", async () => {
    rows.push(row());
    update.mockRejectedValue(new Error("stripe down"));
    expect(await endDueSubscriptions()).toBe(0);
    expect(rows[0].cancelAt).toBeNull();
  });
});
