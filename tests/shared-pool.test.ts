import { describe, it, expect, vi } from "vitest";

/** SHARED_POOL (lib/sharedPool.ts). Pure rules + delivery/charge with mocked deps; never touches a real DB. */

const payments: any[] = [];
const delivered: any[] = [];
vi.mock("@/lib/prisma", () => ({
  prisma: {
    adSpendPayment: { create: vi.fn(async ({ data }: any) => { payments.push(data); return data; }) },
  },
  isDatabaseConfigured: true,
}));
vi.mock("@/lib/house", () => ({
  deliverLeadToOwner: vi.fn(async (...args: any[]) => { delivered.push(args); return args[0] !== "TAKEN"; }),
}));
vi.mock("@/lib/adSpend", () => ({
  SHARED_LEAD_METHOD: "shared-lead",
  getAdSpendSummary: vi.fn(),
  forgetAdSpendSummary: vi.fn(),
}));

const { sharedPoolOf, cplFromInsights, licensedIn, deliverSharedLeadToClient } = await import("@/lib/sharedPool");

describe("shared lead pool", () => {
  it("takes ABCA quiz leads and Enhanced Wealth Blue Collar page leads only", () => {
    expect(sharedPoolOf({ source: "early-retirement-quiz", rawFormData: {} })).toBe("abca");
    expect(sharedPoolOf({ source: "facebook", rawFormData: {}, campaignName: "Blue Collar ER - Updated Messaging OTP", packageId: "blue-collar-iul" })).toBe("ew");
    // EWWS page, nurses, and a client's own campaign leads stay out.
    expect(sharedPoolOf({ source: "facebook", rawFormData: {}, campaignName: "EWWS - Blue Collar - Instant Form - Closed Deals", packageId: "blue-collar-iul" })).toBeNull();
    expect(sharedPoolOf({ source: "facebook", rawFormData: {}, campaignName: "Blue Collar ER - Updated Messaging OTP", packageId: "healthcare-iul" })).toBeNull();
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
});
