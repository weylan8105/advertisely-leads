import { describe, it, expect, vi, beforeEach } from "vitest";

// Advertiser budget: 3% of each payment for card processing, a 20% service fee
// on monthly spend over $15,000, campaigns capped / paused at what the client
// has paid for, and daily budgets paced to spend it by a target date.

let user: any;
let charges: any[];
let manual: any[] = [];
let invoices: Record<string, any> = {};
let guestCharges: any[] = [];
const updates: any[] = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => user),
      update: vi.fn(async (args: any) => {
        updates.push(args.data);
        Object.assign(user, args.data);
      }),
    },
    order: { findMany: vi.fn(async () => []) },
    leadSubscription: { findMany: vi.fn(async () => []) },
    adSpendPayment: { findMany: vi.fn(async () => manual) },
    $queryRaw: vi.fn(async () => [{ total: 10n, this_month: 4n }]),
  },
}));
vi.mock("@/lib/stripe", () => ({
  stripe: {
    customers: { list: vi.fn(async () => ({ data: [{ id: "cus_1" }] })) },
    charges: {
      list: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          for (const c of charges) yield c;
        },
      })),
      search: vi.fn(() => ({
        async *[Symbol.asyncIterator]() {
          for (const c of guestCharges) yield c;
        },
      })),
    },
    invoices: { list: vi.fn(), retrieve: vi.fn(async (id: string) => invoices[id]) },
    invoicePayments: {
      list: vi.fn(async ({ payment }: any) => ({
        data: Object.keys(invoices).filter((id) => invoices[id].pi === payment.payment_intent).map((invoice) => ({ invoice })),
      })),
    },
    checkout: { sessions: { list: vi.fn(async () => ({ data: [] })) } },
  },
}));
const setCampaignStatus = vi.fn(async () => undefined);
const setCampaignSpendCap = vi.fn(async () => undefined);
const setDailyBudget = vi.fn(async () => undefined);
vi.mock("@/lib/metaAds", () => ({ setCampaignStatus, setCampaignSpendCap, setDailyBudget }));

// Sunday Nov 8, 2026, midday Central: 23 days through Nov 30.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-08T18:00:00Z"));

// Meta: one campaign "Advertisely Advertiser - Jace Jensen", $97/day, $500 spent this month.
let campaignStatus = "ACTIVE";
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" })
  .format(new Date())
  .slice(0, 7);
vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string) => {
    const json = (data: any) => ({ ok: true, json: async () => ({ data }) });
    if (url.includes("/campaigns?")) {
      return json(url.includes("act_2126340781245705")
        ? [{ id: "C1", name: "Advertisely Advertiser - Jace Jensen", effective_status: campaignStatus, spend_cap: null }]
        : []);
    }
    if (url.includes("/insights?")) return json([{ date_start: `${month}-01`, spend: "500.00" }]);
    if (url.includes("/adsets?")) return json([{ id: "AS1", daily_budget: "9700", effective_status: "ACTIVE" }]);
    throw new Error(`unexpected ${url}`);
  }),
);
process.env.META_ADS_ACCESS_TOKEN = "t";

const paid = (dollars: number, extra: any = {}) => ({
  id: `ch_${Math.random()}`, status: "succeeded", paid: true, amount: dollars * 100, amount_refunded: 0, created: 1_762_000_000, payment_intent: `pi_${Math.random()}`, description: "Ad Spend", ...extra,
});

beforeEach(() => {
  vi.resetModules();
  user = { id: "JACE", name: "Jace Jensen", email: "jace@gmail.com", adCampaignIds: [], adSpendAutoPause: true, adSpendPausedCampaignIds: [], adSpendTargetDate: null };
  charges = [paid(1000)];
  manual = [];
  invoices = {};
  guestCharges = [];
  updates.length = 0;
  campaignStatus = "ACTIVE";
  setCampaignStatus.mockClear();
  setCampaignSpendCap.mockClear();
  setDailyBudget.mockClear();
});

describe("pricing", () => {
  it("adds a 20% service fee only on a month's spend over $15,000", async () => {
    const { chargeForMonth, processingFeeCents } = await import("@/lib/adSpend");
    expect(chargeForMonth("2026-11", 100_000)).toMatchObject({ serviceFeeCents: 0, chargedCents: 100_000 });
    expect(chargeForMonth("2026-11", 2_000_000)).toMatchObject({ serviceFeeCents: 100_000, chargedCents: 2_100_000 });
    expect(processingFeeCents(100_000)).toBe(3_000);
  });

  it("works out how much more spend a balance covers", async () => {
    const { affordableSpendCents } = await import("@/lib/adSpend");
    expect(affordableSpendCents(97_000, 0)).toBe(97_000);
    expect(affordableSpendCents(0, 0)).toBe(0);
    // $1,000 under the threshold at $1, the rest at $1.20.
    expect(affordableSpendCents(100_000 + 120_000, 1_400_000)).toBe(200_000);
  });

  it("paces to the target date, or month end, within the step limits", async () => {
    const { targetDateFor, daysThrough, pacedDailyBudget } = await import("@/lib/adSpend");
    expect(targetDateFor(null)).toBe("2026-11-30");
    expect(targetDateFor(new Date("2026-11-20T00:00:00Z"))).toBe("2026-11-20");
    expect(targetDateFor(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-30"); // passed
    expect(daysThrough("2026-11-30")).toBe(23);
    expect(pacedDailyBudget(230_000, 23, 10_000)).toBe(10_000);
    expect(pacedDailyBudget(2_300_000, 23, 10_000)).toBe(20_000); // at most 2x in a step
    expect(pacedDailyBudget(23_000, 23, 10_000)).toBe(5_000); // at most half
    expect(pacedDailyBudget(500, 23, null)).toBe(1_000); // $10 floor
  });
});

describe("summary", () => {
  it("counts only Stripe payments titled ad spend, not the monthly service subscription", async () => {
    charges = [
      paid(1000, { description: "Subscription creation", payment_intent: "pi_ads" }),
      paid(3000, { description: "Subscription creation", payment_intent: "pi_service" }),
      paid(200, { description: null, metadata: { kind: "ad-spend" } }),
    ];
    invoices = {
      in_ads: { pi: "pi_ads", lines: { data: [{ description: "1 × Ad Spend (at $1,000.00 / month)" }] } },
      in_service: { pi: "pi_service", lines: { data: [{ description: "1 × Advertisely Advertiser Services (at $3,000.00 / month)" }] } },
    };
    const { getAdSpendSummary } = await import("@/lib/adSpend");
    const s = (await getAdSpendSummary("JACE", { fresh: true }))!;
    expect(s.paidCents).toBe(120_000);
    expect(s.processingFeeCents).toBe(3_600);
    expect(s.otherStripePayments.map((p) => p.amountCents)).toEqual([300_000]);
    expect(s.payments.find((p) => p.amountCents === 100_000)?.description).toMatch(/Ad Spend/);
  });

  it("finds guest payments by billing email, without counting one twice", async () => {
    const shared = paid(1000);
    charges = [shared];
    guestCharges = [shared, paid(500, { description: "Adspend Budget", customer: null })];
    const { getAdSpendSummary } = await import("@/lib/adSpend");
    const s = (await getAdSpendSummary("JACE", { fresh: true }))!;
    expect(s.paidCents).toBe(150_000);
  });

  it("counts Zelle payments in full, with no card processing fee", async () => {
    manual = [{ id: "m1", amountCents: 50_000, method: "zelle", note: "rest of payment", receivedAt: new Date("2026-11-08T17:00:00Z") }];
    const { getAdSpendSummary } = await import("@/lib/adSpend");
    const s = (await getAdSpendSummary("JACE", { fresh: true }))!;
    expect(s.paidCents).toBe(150_000);
    expect(s.processingFeeCents).toBe(3_000); // 3% of the $1,000 card payment only
    expect(s.availableCents).toBe(147_000);
    expect(s.balanceCents).toBe(97_000);
    expect(s.payments.map((p) => [p.method, p.processingFeeCents])).toEqual([["zelle", 0], ["card", 3_000]]);
  });

  it("is paid minus 3% processing minus spend, with cost per lead", async () => {
    charges = [paid(1000), paid(300, { amount_refunded: 10_000 }), { ...paid(50), status: "failed", paid: false }];
    const { getAdSpendSummary } = await import("@/lib/adSpend");
    const s = (await getAdSpendSummary("JACE", { fresh: true }))!;
    expect(s.paidCents).toBe(120_000);
    expect(s.processingFeeCents).toBe(3_600);
    expect(s.availableCents).toBe(116_400);
    expect(s.chargedCents).toBe(50_000);
    expect(s.balanceCents).toBe(66_400);
    expect(s.leads).toBe(10);
    expect(s.costPerLeadCents).toBe(5_000);
    expect(s.daysLeft).toBe(6); // 664 / 97 a day
    expect(s.targetDate).toBe("2026-11-30");
    expect(s.pacedDailyCents).toBe(2_886); // 664 over 23 days
    expect(s.errors).toEqual([]);
  });
});

describe("budget management", () => {
  it("caps the campaign at what the balance covers and paces the daily budget", async () => {
    const { enforceAdSpend } = await import("@/lib/adSpend");
    const r = await enforceAdSpend("JACE");
    expect(r.action).toBe("capped");
    // $500 spent, plus the $470 left of $970 available.
    expect(setCampaignSpendCap).toHaveBeenCalledWith("C1", 97_000);
    // $470 over 23 days is $20/day; one step can only halve $97, so $48.50 → $49.
    expect(setDailyBudget).toHaveBeenCalledWith("AS1", 4_900);
    expect(setCampaignStatus).not.toHaveBeenCalled();
    expect(updates.at(-1).adSpendPacedAt).toBeInstanceOf(Date);
  });

  it("pauses when the budget is used up, and resumes after they add spend", async () => {
    charges = [paid(400)];
    const { enforceAdSpend } = await import("@/lib/adSpend");
    expect((await enforceAdSpend("JACE")).action).toBe("paused");
    expect(setCampaignStatus).toHaveBeenCalledWith("C1", "PAUSED");
    expect(user.adSpendPausedCampaignIds).toEqual(["C1"]);

    campaignStatus = "PAUSED";
    charges = [paid(400), paid(1000)];
    expect((await enforceAdSpend("JACE")).action).toBe("capped");
    expect(setCampaignStatus).toHaveBeenLastCalledWith("C1", "ACTIVE");
    expect(user.adSpendPausedCampaignIds).toEqual([]);
  });

  it("does nothing when management is off", async () => {
    user.adSpendAutoPause = false;
    charges = [];
    const { enforceAdSpend } = await import("@/lib/adSpend");
    expect((await enforceAdSpend("JACE")).action).toBe("skipped");
    expect(setCampaignStatus).not.toHaveBeenCalled();
  });

  it("never pauses on a failed read", async () => {
    user.name = "Someone Else"; // no campaign by that name
    charges = [];
    const { enforceAdSpend } = await import("@/lib/adSpend");
    const r = await enforceAdSpend("JACE");
    expect(r.action).toBe("skipped");
    expect(r.detail).toMatch(/No campaign/);
    expect(setCampaignStatus).not.toHaveBeenCalled();
  });
});

describe("budget management on a campaign the client paused", () => {
  it("still caps it, without turning it on or touching its budget", async () => {
    campaignStatus = "PAUSED";
    const { enforceAdSpend } = await import("@/lib/adSpend");
    expect((await enforceAdSpend("JACE")).action).toBe("capped");
    expect(setCampaignSpendCap).toHaveBeenCalledWith("C1", 97_000);
    expect(setCampaignStatus).not.toHaveBeenCalled();
    expect(setDailyBudget).not.toHaveBeenCalled();
  });
});
