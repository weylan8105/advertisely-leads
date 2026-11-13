import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * HOUSE_PAUSE (lib/housePause.ts): while it is on, nothing new is routed to the
 * house account (Ryan). Mocked prisma with SYNTHETIC data; never touches a real DB.
 */

const created: any[] = [];
const prismaMock = {
  $queryRaw: vi.fn(async () => []),
  user: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.id === "RYAN" ? { email: "RyanRush129@gmail.com" } : where.id === "JACE" ? { email: "jace@example.com" } : null,
    ),
    findMany: vi.fn(async () => [
      { id: "RYAN", email: "ryanrush129@gmail.com", weeklyLeadTarget: 100, licensedStates: [], ownedOrganizations: [{ id: "ryans-team" }] },
      { id: "OTHER", email: "other-admin@example.com", weeklyLeadTarget: 10, licensedStates: ["TX"], ownedOrganizations: [] },
    ]),
  },
  lead: {
    count: vi.fn(async () => 0),
    findUnique: vi.fn(async () => null),
    create: vi.fn(async ({ data }: any) => {
      const row = { id: `L${created.length + 1}`, ...data };
      created.push(row);
      return row;
    }),
    update: vi.fn(),
  },
  leadActivity: { create: vi.fn() },
  distributionCursor: { findUnique: vi.fn(), upsert: vi.fn() },
  metaFormMapping: {
    findUnique: vi.fn(async ({ where }: any) =>
      where.formId === "RYAN_FORM"
        ? { ownerUserId: "RYAN", enabled: true }
        : where.formId === "JACE_FORM"
          ? { ownerUserId: "JACE", enabled: true }
          : null,
    ),
  },
};
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));
const tryFulfillForNewLead = vi.fn(async () => undefined);
vi.mock("@/lib/fulfillment", () => ({ tryFulfillForNewLead }));
const fireMetaLeadEvent = vi.fn(async () => undefined);
vi.mock("@/lib/metaCapi", () => ({ fireMetaLeadEvent }));

import { HOUSE_PAUSE, isPausedHouseUser } from "@/lib/housePause";
import { getEligibleAdminSlots } from "@/lib/house";
import { routeEwTextVerifiedToGuest, isEwTextVerifiedLead, EW_TEXT_VERIFIED_FORM_IDS } from "@/lib/tempRotationGuest";

const wasEnabled = HOUSE_PAUSE.enabled;
beforeEach(() => {
  created.length = 0;
  vi.clearAllMocks();
  HOUSE_PAUSE.enabled = true;
});
afterEach(() => {
  HOUSE_PAUSE.enabled = wasEnabled;
});

describe("house pause", () => {
  it("recognises the house account only while the pause is on", async () => {
    expect(await isPausedHouseUser("RYAN")).toBe(true);
    expect(await isPausedHouseUser("JACE")).toBe(false);
    expect(await isPausedHouseUser(null)).toBe(false);
    HOUSE_PAUSE.enabled = false;
    expect(await isPausedHouseUser("RYAN")).toBe(false);
  });

  it("drops Ryan's overflow slot from the rotation, and keeps other admins'", async () => {
    expect((await getEligibleAdminSlots()).map((s) => s.userId)).toEqual(["OTHER"]);
    HOUSE_PAUSE.enabled = false;
    expect((await getEligibleAdminSlots()).map((s) => s.userId)).toEqual(["RYAN", "OTHER"]);
  });

  it("stops the Ryan / guest alternation on text-verified leads", async () => {
    const formId = [...EW_TEXT_VERIFIED_FORM_IDS][0];
    const rawFormData = { form_id: formId, formId };
    expect(isEwTextVerifiedLead({ rawFormData })).toBe(true);
    const took = await routeEwTextVerifiedToGuest({ id: "L1", state: "TX", rawFormData });
    expect(took).toBe(false);
    expect(prismaMock.distributionCursor.upsert).not.toHaveBeenCalled();
  });

  it("sends a lead from a form Ryan owns through the rotation, not to Ryan", async () => {
    const { normalizeInboundLead } = await import("@/lib/inboundLead");
    const { createInboundLead } = await import("@/lib/inboundIntake");
    const house = await import("@/lib/house");
    const deliver = vi.spyOn(house, "deliverLeadToOwner").mockResolvedValue(true);
    const payload = (formId: string) =>
      normalizeInboundLead({
        full_name: "Pat Lineman",
        phone: "+15555550123",
        email: "pat.lineman@gmail.com",
        contact_id: `c-${formId}`,
        attributionSource: { formId },
      });

    await createInboundLead(payload("RYAN_FORM"), { activityBody: "t" });
    expect(tryFulfillForNewLead).toHaveBeenCalledWith("L1");
    expect(fireMetaLeadEvent).not.toHaveBeenCalled();

    // Another advertiser's form is untouched by the pause.
    await createInboundLead(payload("JACE_FORM"), { activityBody: "t" });
    expect(tryFulfillForNewLead).toHaveBeenCalledTimes(1);
    deliver.mockRestore();
  });
});
