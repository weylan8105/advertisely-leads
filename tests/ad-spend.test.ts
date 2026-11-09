import { describe, it, expect, vi, beforeEach } from "vitest";

// Advertiser budget: spend + 3%, a 20% service fee on monthly spend over
// $15,000, and campaigns capped / paused at what the client has paid for.

let user: any;
let charges: any[];
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
    },
    invoices: { list: vi.fn() },
  },
}));
const setCampaignStatus = vi.fn(async () => undefined);
const setCampaignSpendCap = vi.fn(async () => undefined);
vi.mock("@/lib/metaAds", () => ({ setCampaignStatus, setCampaignSpendCap }));

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
    if (url.includes("/adsets?")) return json([{ daily_budget: "9700", effective_status: "ACTIVE" }]);
    throw new Error(`unexpected ${url}`);
  }),
);
process.env.META_ADS_ACCESS_TOKEN = "t";

const paid = (dollars: number, extra: any = {}) => ({
  id: `ch_${Math.random()}`, status: "succeeded", paid: true, amount: dollars * 100, amount_refunded: 0, created: 1_762_000_000, payment_intent: `pi_${Math.random()}`, ...extra,
});

beforeEach(() => {
  vi.resetModules();
  user = { id: "JACE", name: "Jace Jensen", email: "jace@gmail.com", adCampaignIds: [], adSpendAutoPause: true, adSpendPausedCampaignIds: [] };
  charges = [paid(1000)];
  updates.length = 0;
  campaignStatus = "ACTIVE";
  setCampaignStatus.mockClear();
  setCampaignSpendCap.mockClear();
});

describe("pricing", () => {
  it("adds 3%, and 20% only on a month's spend over $15,000", async () => {
    const { chargeForMonth } = await import("@/lib/adSpend");
    expect(chargeForMonth("2026-11", 100_000)).toMatchObject({ cardFeeCents: 3_000, serviceFeeCents: 0, chargedCents: 103_000 });
    expect(chargeForMonth("2026-11", 2_000_000)).toMatchObject({ cardFeeCents: 60_000, serviceFeeCents: 100_000, chargedCents: 2_160_000 });
  });

  it("works out how much more spend a balance covers", async () => {
    const { affordableSpendCents } = await import("@/lib/adSpend");
    expect(affordableSpendCents(103_000, 0)).toBe(100_000);
    expect(affordableSpendCents(0, 0)).toBe(0);
    // $1,000 under the threshold at 1.03, the rest at 1.23.
    expect(affordableSpendCents(103_000 + 123_000, 1_400_000)).toBe(200_000);
  });
});

describe("summary", () => {
  it("is paid minus spend with fees, with cost per lead", async () => {
    charges = [paid(1000), paid(300, { amount_refunded: 10_000 }), { ...paid(50), status: "failed", paid: false }];
    const { getAdSpendSummary } = await import("@/lib/adSpend");
    const s = (await getAdSpendSummary("JACE", { fresh: true }))!;
    expect(s.paidCents).toBe(120_000);
    expect(s.chargedCents).toBe(51_500);
    expect(s.balanceCents).toBe(68_500);
    expect(s.leads).toBe(10);
    expect(s.costPerLeadCents).toBe(5_150);
    expect(s.daysLeft).toBe(6); // 685 / 99.91 a day
    expect(s.errors).toEqual([]);
  });
});

describe("auto-pause", () => {
  it("caps the campaign at the spend the balance covers", async () => {
    const { enforceAdSpend } = await import("@/lib/adSpend");
    const r = await enforceAdSpend("JACE");
    expect(r.action).toBe("capped");
    // $500 spent, plus the $470.87 more that the $485 balance covers at 1.03.
    expect(setCampaignSpendCap).toHaveBeenCalledWith("C1", 50_000 + 47_087);
    expect(setCampaignStatus).not.toHaveBeenCalled();
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

  it("does nothing when auto-pause is off", async () => {
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

describe("auto-pause on a campaign the client paused", () => {
  it("still caps it, without turning it on", async () => {
    campaignStatus = "PAUSED";
    const { enforceAdSpend } = await import("@/lib/adSpend");
    expect((await enforceAdSpend("JACE")).action).toBe("capped");
    expect(setCampaignSpendCap).toHaveBeenCalledWith("C1", 50_000 + 47_087);
    expect(setCampaignStatus).not.toHaveBeenCalled();
  });
});
