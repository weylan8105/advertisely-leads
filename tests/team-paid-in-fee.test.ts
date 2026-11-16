import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: null, isDatabaseConfigured: false }));
vi.mock("../lib/prisma", () => ({ prisma: null, isDatabaseConfigured: false }));

import { paidInFees, paymentsPaidIn, type TeamPayment } from "../lib/teamPaidInFee";
import { PAID_IN_FEE_TEAMS, isPaidInFeeAdvertiser } from "../lib/paidInFeeTeams";
import { chargeForMonth, affordableSpendCents } from "../lib/adSpend";

// Jace's team, November 2026, as paid in (card amounts) — totals $17,100.
const NOV: TeamPayment[] = [
  { id: "j1", userId: "jace", at: "2026-11-03T00:08:00Z", grossCents: 70_000 },
  { id: "j2", userId: "jace", at: "2026-11-08T20:15:00Z", grossCents: 140_000 },
  { id: "j3", userId: "jace", at: "2026-11-09T01:00:00Z", grossCents: 300_000 },
  { id: "j4", userId: "jace", at: "2026-11-09T01:14:00Z", grossCents: 100_000 },
  { id: "jacob1", userId: "jacob", at: "2026-11-10T23:20:00Z", grossCents: 100_000 },
  { id: "dan1", userId: "daniel", at: "2026-11-11T17:56:00Z", grossCents: 300_000 },
  { id: "bay1", userId: "baylor", at: "2026-11-16T01:09:00Z", grossCents: 100_000 },
  { id: "mar1", userId: "marcos", at: "2026-11-16T03:41:00Z", grossCents: 125_000 },
  { id: "jam1", userId: "james", at: "2026-11-16T03:53:00Z", grossCents: 125_000 },
  { id: "adr1", userId: "adrian", at: "2026-11-16T04:05:00Z", grossCents: 100_000 },
  { id: "jacob2", userId: "jacob", at: "2026-11-16T04:49:00Z", grossCents: 250_000 },
];
const SETTLED = PAID_IN_FEE_TEAMS[0].settledThrough;

describe("team paid-in management fee", () => {
  it("charges nothing for November's first $17,100 (settled by hand)", () => {
    expect(paidInFees(NOV, SETTLED)).toEqual([]);
  });

  it("would have been $420 on the payment that crossed the line, with no settlement", () => {
    const fees = paidInFees(NOV, "2026-01-01T00:00:00Z");
    expect(fees).toHaveLength(1);
    expect(fees[0].payment.id).toBe("jacob2");
    expect(fees[0].feeCents).toBe(42_000);
  });

  it("takes 20% of every new payment once the team is past $15,000", () => {
    const next: TeamPayment = { id: "dan2", userId: "daniel", at: "2026-11-20T15:00:00Z", grossCents: 100_000 };
    const fees = paidInFees([...NOV, next], SETTLED);
    expect(fees).toEqual([{ payment: next, month: "2026-11", feeCents: 20_000 }]);
  });

  it("only charges the part of a payment past the line, and starts over each month (Central time)", () => {
    const pays: TeamPayment[] = [
      { id: "a", userId: "u1", at: "2026-12-02T15:00:00Z", grossCents: 1_400_000 },
      { id: "b", userId: "u2", at: "2026-12-03T15:00:00Z", grossCents: 300_000 }, // $1,000 below, $2,000 past
      // 11pm Central on Dec 31 is still December; 1am Central Jan 1 is January.
      { id: "c", userId: "u1", at: "2027-01-01T05:00:00Z", grossCents: 100_000 },
      { id: "d", userId: "u1", at: "2027-01-01T07:00:00Z", grossCents: 100_000 },
    ];
    const fees = paidInFees(pays, SETTLED);
    expect(fees.map((f) => [f.payment.id, f.feeCents])).toEqual([["b", 40_000], ["c", 20_000]]);
  });

  it("counts card top-ups, team checkouts and Zelle, not moves, program top-ups or fees", () => {
    const got = paymentsPaidIn({
      userId: "jacob",
      payments: [
        { id: "ch1", at: "2026-11-16T04:49:00Z", amountCents: 250_000, description: "ad spend", method: "card", processingFeeCents: 7_500 },
        { id: "mv", at: "2026-11-10T23:20:00Z", amountCents: 97_000, description: "moved", method: "other", processingFeeCents: 0 },
        { id: "pg", at: "2026-11-17T00:00:00Z", amountCents: 50_000, description: "program top-up", method: "card", processingFeeCents: 0 },
        { id: "z", at: "2026-11-18T00:00:00Z", amountCents: 20_000, description: null, method: "zelle", processingFeeCents: 0 },
        { id: "teamfee_x", at: "2026-11-18T00:00:00Z", amountCents: -20_000, description: null, method: "team-fee", processingFeeCents: 0 },
      ],
      otherStripePayments: [
        { id: "ch0", at: "2026-11-10T23:20:00Z", amountCents: 100_000, description: "Team campaign funding: Jace Jensen", method: "card", processingFeeCents: 0 },
        { id: "sub", at: "2026-11-02T00:00:00Z", amountCents: 300_000, description: "Advertisely Advertiser", method: "card", processingFeeCents: 0 },
      ],
    });
    expect(got.map((p) => [p.id, p.grossCents]).sort()).toEqual([["ch0", 100_000], ["ch1", 250_000], ["z", 20_000]]);
  });

  it("Jace pays no spend-based fee on top of the paid-in one", () => {
    const jace = PAID_IN_FEE_TEAMS[0].advertiserId;
    expect(isPaidInFeeAdvertiser(jace)).toBe(true);
    expect(chargeForMonth("2026-11", 2_000_000, true).serviceFeeCents).toBe(0);
    expect(chargeForMonth("2026-11", 2_000_000).serviceFeeCents).toBe(100_000);
    expect(affordableSpendCents(500_000, 1_600_000, true)).toBe(500_000);
  });
});
