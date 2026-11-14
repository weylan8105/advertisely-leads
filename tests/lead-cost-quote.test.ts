import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Enhanced Wealth lock-in quote (lib/leadCostLedger.ts): a fixed bill shown on
 * Ryan's dashboard until it is paid. Mocked prisma with SYNTHETIC payments; never
 * touches a real DB.
 */

let payments: { id: string; amountCents: number; method: string; note: string | null; receivedAt: Date }[] = [];
const prismaMock = {
  adSpendPayment: { findMany: vi.fn(async () => [...payments].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())) },
  distributionCursor: { findUnique: vi.fn(), upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));
vi.mock("@/lib/house", () => ({ getHouseAccount: vi.fn(async () => ({ userId: "RYAN", organizationId: "ryans-team" })) }));

import { buildLeadCostLedger, LOCKIN_QUOTE } from "@/lib/leadCostLedger";

const pay = (id: string, dollars: number, at: string) => ({ id, amountCents: Math.round(dollars * 100), method: "bank", note: null, receivedAt: new Date(at) });

beforeEach(() => {
  payments = [];
});

describe("lock-in quote", () => {
  it("adds up: sources and days both equal the billed leads, and the total is leads × rate", () => {
    const sum = (rows: { leads: number }[]) => rows.reduce((s, r) => s + r.leads, 0);
    expect(sum(LOCKIN_QUOTE.lines)).toBe(LOCKIN_QUOTE.leads);
    expect(sum(LOCKIN_QUOTE.days)).toBe(LOCKIN_QUOTE.leads);
    expect(LOCKIN_QUOTE.totalCents).toBe(LOCKIN_QUOTE.leads * LOCKIN_QUOTE.cplCents);
    expect(LOCKIN_QUOTE.cplCents).toBe(Math.round(LOCKIN_QUOTE.adSpendCents / LOCKIN_QUOTE.leadsGenerated));
  });

  it("stays owed in full until a transfer is recorded after the lock-in closed", async () => {
    // The Nov 10 transfer paid the week before the lock-in: listed, not applied.
    payments = [pay("old", 2300.32, "2026-11-10T22:59:49Z")];
    const l = (await buildLeadCostLedger(new Date("2026-11-14T02:00:00Z")))!;
    expect(l.owedCents).toBe(LOCKIN_QUOTE.totalCents);
    expect(l.paidCents).toBe(0);
    expect(l.balanceCents).toBe(-LOCKIN_QUOTE.totalCents);
    expect(l.settled).toBe(false);
    expect(l.payments).toHaveLength(0);
    expect(l.earlierPayments.map((p) => p.id)).toEqual(["old"]);
    expect(l.totalLeads).toBe(LOCKIN_QUOTE.leads);
  });

  it("counts part payments and settles once the full amount is in", async () => {
    payments = [pay("a", 2000, "2026-11-14T15:00:00Z")];
    let l = (await buildLeadCostLedger(new Date("2026-11-14T16:00:00Z")))!;
    expect(l.paidCents).toBe(200_000);
    expect(l.balanceCents).toBe(200_000 - LOCKIN_QUOTE.totalCents);
    expect(l.settled).toBe(false);

    payments.push(pay("b", (LOCKIN_QUOTE.totalCents - 200_000) / 100, "2026-11-15T15:00:00Z"));
    l = (await buildLeadCostLedger(new Date("2026-11-15T16:00:00Z")))!;
    expect(l.balanceCents).toBe(0);
    expect(l.settled).toBe(true);
    expect(l.lastWeek.leads).toBe(0); // no reminder once paid
  });

  it("holds the weekly reminder until the lock-in week is over, then asks for what is left", async () => {
    payments = [pay("a", 1000, "2026-11-14T15:00:00Z")];
    // Friday of the lock-in week: last completed week is Nov 2–8, nothing to remind.
    let l = (await buildLeadCostLedger(new Date("2026-11-14T16:00:00Z")))!;
    expect(l.lastWeek.leads).toBe(0);
    expect(l.lastWeek.owedCents).toBe(0);
    // The Tuesday after: the lock-in week is the last completed week.
    l = (await buildLeadCostLedger(new Date("2026-11-17T18:00:00Z")))!;
    expect(l.lastWeek.leads).toBe(LOCKIN_QUOTE.leads);
    expect(l.lastWeek.owedCents).toBe(LOCKIN_QUOTE.totalCents - 100_000);
    // Still asking a week later while unpaid, keyed to the new week.
    const later = (await buildLeadCostLedger(new Date("2026-11-24T18:00:00Z")))!;
    expect(later.lastWeek.leads).toBe(LOCKIN_QUOTE.leads);
    expect(later.lastWeek.startIso).not.toBe(l.lastWeek.startIso);
  });
});
