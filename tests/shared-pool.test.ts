import { describe, it, expect, vi } from "vitest";

/** SHARED_POOL (lib/sharedPool.ts). Pure rules + delivery/charge with mocked deps; never touches a real DB. */

const payments: any[] = [];
const delivered: any[] = [];
const advertisers: any[] = [];
const summaries = new Map<string, any>();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adSpendPayment: { create: vi.fn(async ({ data }: any) => { payments.push(data); return data; }) },
    user: { findMany: vi.fn(async () => advertisers) },
  },
  isDatabaseConfigured: true,
}));
vi.mock("@/lib/house", () => ({
  deliverLeadToOwner: vi.fn(async (...args: any[]) => { delivered.push(args); return args[0] !== "TAKEN"; }),
}));
vi.mock("@/lib/adSpend", () => ({
  SHARED_LEAD_METHOD: "shared-lead",
  getAdSpendSummary: vi.fn(async (id: string) => summaries.get(id) ?? null),
  forgetAdSpendSummary: vi.fn(),
}));

const { sharedPoolOf, cplFromInsights, combineInsights, licensedIn, deliverSharedLeadToClient, sharedClientSlots, TOGGLE_ONLY_POOLS, recentCplCents, MIN_SHARED_CPL_CENTS } =
  await import("@/lib/sharedPool");
const { leadTypeOn, enabledLeadTypes, storedLeadTypes } = await import("@/lib/leadTypes");

describe("shared lead pool", () => {
  it("takes ABCA quiz leads and Enhanced Wealth Blue Collar page leads only", () => {
    expect(sharedPoolOf({ source: "early-retirement-quiz", rawFormData: {} })).toBe("abca");
    expect(sharedPoolOf({ source: "facebook", rawFormData: {}, campaignName: "Blue Collar ER - Updated Messaging OTP", packageId: "blue-collar-iul" })).toBe("ew");
    // A client's own campaign leads stay out.
    expect(sharedPoolOf({ source: "facebook", rawFormData: { advertiser_name: "Jace Jensen" }, campaignName: "Advertisely Advertiser - Jace Jensen", packageId: "blue-collar-iul" })).toBeNull();
  });

  it("cost per lead = spend / leads from Meta insights", () => {
    expect(cplFromInsights({ spend: "4712.56", actions: [{ action_type: "lead", value: "146" }] })).toBe(3228);
    expect(cplFromInsights({ spend: "3129.50", actions: [{ action_type: "offsite_conversion.fb_pixel_lead", value: "153" }] })).toBe(2045);
    expect(cplFromInsights({ spend: "10", actions: [] })).toBeNull();
    expect(cplFromInsights(undefined)).toBeNull();
  });

  it("licensing: none on file means everywhere", () => {
    expect(licensedIn([], "TX")).toBe(true);
    expect(licensedIn(["TX"], "TX")).toBe(true);
    expect(licensedIn(["TX"], "CA")).toBe(false);
  });

  it("delivers like the client's own campaign and charges their balance once", async () => {
    const ok = await deliverSharedLeadToClient("L1", { userId: "JACE", name: "Jace", cplCents: 2045 }, "abca");
    expect(ok).toBe(true);
    expect(delivered[0][1]).toBe("JACE");
    expect(delivered[0][3]).toEqual({ skipTeamFunding: true });
    expect(payments).toEqual([expect.objectContaining({ userId: "JACE", amountCents: -2045, method: "shared-lead" })]);
  });

  it("a free slot delivers the lead without charging", async () => {
    payments.length = 0;
    expect(await deliverSharedLeadToClient("L2", { userId: "DAVID", name: "David", cplCents: 0, free: true }, "ew")).toBe(true);
    expect(payments).toEqual([]);
  });

  it("charges nothing when the lead was already taken", async () => {
    payments.length = 0;
    expect(await deliverSharedLeadToClient("TAKEN", { userId: "JACE", name: "Jace", cplCents: 2045 }, "abca")).toBe(false);
    expect(payments).toEqual([]);
  });

  it("puts nurse leads (EWWS Nurses form, HWA quiz) in their own opt-in pool", () => {
    expect(sharedPoolOf({ source: "facebook", rawFormData: {}, campaignName: "EWWS - Nurses - Instant Form - Closed Deals", packageId: "healthcare-iul" })).toBe("nurse");
    expect(sharedPoolOf({ source: "healthcare-wealth-quiz", rawFormData: {}, packageId: "healthcare-iul" })).toBe("nurse");
    // Already delivered to someone, or a client's own nurse campaign: not ours to share.
    expect(sharedPoolOf({ source: "facebook", rawFormData: { advertiser_name: "Ryan" }, packageId: "healthcare-iul" })).toBeNull();
    expect(sharedPoolOf({ source: "facebook", rawFormData: {}, campaignName: "Advertisely Advertiser - Jace Jensen", packageId: "healthcare-iul" })).toBeNull();
  });

  it("adds up several campaigns' insights for one pool's cost per lead", () => {
    const row = combineInsights([
      { spend: "100.00", actions: [{ action_type: "lead", value: "5" }] },
      undefined,
      { spend: "50.00", actions: [{ action_type: "lead", value: "5" }] },
    ]);
    expect(cplFromInsights(row)).toBe(1500);
    expect(combineInsights([undefined])).toBeUndefined();
  });

  // Shapes copied from real prod leads (Nov 2026), names and contact details left out.
  const EWWS_NURSE = { source: "facebook", rawFormData: { campaignId: "120249692494360601" }, campaignName: "EWWS - Nurses - Instant Form - Closed Deals", packageId: "healthcare-iul" };
  const EWWS_NURSE_NO_NAME = { source: "Facebook instant form", rawFormData: { meta: { campaignId: "120249692494360601" } }, campaignName: "", packageId: "healthcare-iul" };
  const EWWS_BC = { source: "facebook", rawFormData: { campaignId: "120249692494140601" }, campaignName: "EWWS - Blue Collar - Instant Form - Closed Deals", packageId: "blue-collar-iul" };
  const EWWS_BC_NO_NAME = { source: "facebook", rawFormData: { campaignId: "120249710458680601" }, campaignName: null, packageId: "blue-collar-iul" };
  const EW_BC = { source: "facebook", rawFormData: {}, campaignName: "Blue Collar ER - Updated Messaging OTP", packageId: "blue-collar-iul" };

  it("sorts Essential Workers leads by campaign: Nurses → nurse, Blue Collar → ewws", () => {
    expect(sharedPoolOf(EWWS_NURSE)).toBe("nurse");
    expect(sharedPoolOf(EWWS_NURSE_NO_NAME)).toBe("nurse");
    expect(sharedPoolOf(EWWS_BC)).toBe("ewws");
    expect(sharedPoolOf(EWWS_BC_NO_NAME)).toBe("ewws");
    // The Nurses campaign wins even if a lead was mislabeled Blue Collar.
    expect(sharedPoolOf({ ...EWWS_NURSE, packageId: "blue-collar-iul" })).toBe("nurse");
    // Enhanced Wealth Blue Collar is unchanged.
    expect(sharedPoolOf(EW_BC)).toBe("ew");
    expect(TOGGLE_ONLY_POOLS.has("ewws") && TOGGLE_ONLY_POOLS.has("nurse")).toBe(true);
    expect(TOGGLE_ONLY_POOLS.has("ew") || TOGGLE_ONLY_POOLS.has("abca")).toBe(false);
  });

  it("stores the switches: Blue Collar on by default, Nurse off by default", () => {
    expect(enabledLeadTypes([])).toEqual(["blue-collar-iul"]);
    expect(storedLeadTypes(["blue-collar-iul", "healthcare-iul"])).toEqual(["healthcare-iul"]);
    expect(storedLeadTypes(["healthcare-iul"])).toEqual(["-blue-collar-iul", "healthcare-iul"]);
    expect(storedLeadTypes([])).toEqual(["-blue-collar-iul"]);
    expect(storedLeadTypes(["junk"])).toEqual(["-blue-collar-iul"]);
    expect(leadTypeOn(["-blue-collar-iul", "healthcare-iul"], "blue-collar-iul")).toBe(false);
    expect(leadTypeOn(["-blue-collar-iul", "healthcare-iul"], "healthcare-iul")).toBe(true);
  });

  it("only offers each lead to advertisers with that lead type on", async () => {
    const summary = { errors: [], program: { mustJoin: false, member: false }, balanceCents: 100_000, costPerLeadCents: 3000, spendCents: 0, leads: 0 };
    advertisers.length = 0;
    advertisers.push(
      { id: "bc-only", name: "Blue Collar only", email: "a@x.test", licensedStates: ["TX"], leadTypes: [], ownedOrganizations: [] },
      { id: "both", name: "Both", email: "b@x.test", licensedStates: ["TX"], leadTypes: ["healthcare-iul"], ownedOrganizations: [] },
      { id: "nurse-only", name: "Nurse only", email: "c@x.test", licensedStates: ["TX"], leadTypes: ["-blue-collar-iul", "healthcare-iul"], ownedOrganizations: [] },
      { id: "nothing", name: "Nothing", email: "d@x.test", licensedStates: ["TX"], leadTypes: ["-blue-collar-iul"], ownedOrganizations: [] },
      { id: "wrong-state", name: "Florida", email: "e@x.test", licensedStates: ["FL"], leadTypes: ["healthcare-iul"], ownedOrganizations: [] },
      { id: "broke", name: "No budget", email: "f@x.test", licensedStates: ["TX"], leadTypes: ["healthcare-iul"], ownedOrganizations: [] },
    );
    for (const a of advertisers) summaries.set(a.id, { ...summary, ...(a.id === "broke" ? { balanceCents: 0 } : {}) });

    const ids = async (pool: any) => (await sharedClientSlots("TX", pool)).map((c) => c.userId);
    expect(await ids("nurse")).toEqual(["both", "nurse-only"]);
    expect(await ids("ewws")).toEqual(["bc-only", "both"]);
    expect(await ids("ew")).toEqual(["bc-only", "both"]);
  });
});

describe("price per lead: last 72 hours, $20 minimum", () => {
  const row = (spend: string, leads: number) => ({ spend, actions: [{ action_type: "lead", value: String(leads) }] });
  it("uses the last 3 days plus today, added together", () => {
    // $900 + $300 over 30 + 10 leads = $30.00
    expect(recentCplCents([row("900.00", 30), row("300.00", 10)], undefined, 9999)).toBe(3000);
    // The week's figure is ignored when the last 72 hours has leads.
    expect(recentCplCents([row("900.00", 30), undefined], row("7000.00", 100), 9999)).toBe(3000);
  });
  it("never charges less than $20", () => {
    expect(MIN_SHARED_CPL_CENTS).toBe(2000);
    expect(recentCplCents([row("174.50", 10)], undefined, 9999)).toBe(2000); // $17.45 → $20
    expect(recentCplCents([], undefined, 1759)).toBe(2000); // fallback below the minimum
  });
  it("falls back to the last 7 days, then the fixed figure, when the 72 hours has no leads", () => {
    expect(recentCplCents([{ spend: "50.00", actions: [] }, undefined], row("640.00", 20), 9999)).toBe(3200);
    expect(recentCplCents([undefined, undefined], undefined, 3228)).toBe(3228);
  });
});
