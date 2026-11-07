import { describe, it, expect, vi, beforeEach } from "vitest";

// GHL forwards Meta form leads with the form id in its attribution. A form
// mapped to an advertiser must route the lead to them (never the marketplace).

const created: any[] = [];
const copies: any[] = [];
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: {
    $queryRaw: vi.fn(async () => copies),
    lead: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        const row = { id: `L${created.length + 1}`, ...data };
        created.push(row);
        return row;
      }),
      update: vi.fn(),
    },
    leadActivity: { create: vi.fn() },
    user: { findUnique: vi.fn(async () => null) },
    metaFormMapping: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.formId === "JACE_FORM" ? { ownerUserId: "JACE", enabled: true } : null,
      ),
    },
  },
}));
const deliverLeadToOwner = vi.fn(async () => true);
vi.mock("@/lib/house", () => ({ deliverLeadToOwner, assignLeadToHouse: vi.fn() }));
const tryFulfillForNewLead = vi.fn(async () => undefined);
vi.mock("@/lib/fulfillment", () => ({ tryFulfillForNewLead }));
const fireMetaLeadEvent = vi.fn(async () => undefined);
vi.mock("@/lib/metaCapi", () => ({ fireMetaLeadEvent }));

const ghl = (attribution: Record<string, unknown>) => ({
  full_name: "Pat Lineman",
  phone: "+15555550123",
  email: "pat.lineman@gmail.com",
  contact_id: `c-${Math.random()}`,
  ...attribution,
});

beforeEach(() => {
  created.length = 0;
  copies.length = 0;
  deliverLeadToOwner.mockClear();
  tryFulfillForNewLead.mockClear();
  fireMetaLeadEvent.mockClear();
});

describe("GHL leads routed by Meta form id", () => {
  it("reads the latest form, not the contact's first touch", async () => {
    const { normalizeInboundLead } = await import("@/lib/inboundLead");
    const lead = normalizeInboundLead(
      ghl({
        attributionSource: JSON.stringify({ formId: "OLD_FORM" }),
        contact: JSON.stringify({ lastAttributionSource: { formId: "JACE_FORM" } }),
      }),
    );
    expect(lead.formId).toBe("JACE_FORM");
    expect(normalizeInboundLead(ghl({ attributionSource: { formId: "X1" } })).formId).toBe("X1");
  });

  it("delivers a mapped advertiser form's lead only to that advertiser", async () => {
    const { normalizeInboundLead } = await import("@/lib/inboundLead");
    const { createInboundLead } = await import("@/lib/inboundIntake");
    const out = await createInboundLead(normalizeInboundLead(ghl({ attributionSource: { formId: "JACE_FORM" } })), { activityBody: "t" });
    expect(out.status).toBe("created");
    expect(deliverLeadToOwner).toHaveBeenCalledWith("L1", "JACE", expect.stringContaining("JACE_FORM"));
    expect(tryFulfillForNewLead).not.toHaveBeenCalled();
    expect(fireMetaLeadEvent).not.toHaveBeenCalled();
  });

  it("drops a GHL lead Meta already brought in for a linked form", async () => {
    copies.push({ id: "M1", rawFormData: {} });
    const { normalizeInboundLead } = await import("@/lib/inboundLead");
    const { createInboundLead } = await import("@/lib/inboundIntake");
    const out = await createInboundLead(normalizeInboundLead(ghl({ attributionSource: { formId: "JACE_FORM" } })), { activityBody: "t" });
    expect(out.status).toBe("duplicate");
    expect(created).toHaveLength(0);
    expect(deliverLeadToOwner).not.toHaveBeenCalled();
  });

  it("leaves leads from unmapped forms on the normal marketplace path", async () => {
    const { normalizeInboundLead } = await import("@/lib/inboundLead");
    const { createInboundLead } = await import("@/lib/inboundIntake");
    await createInboundLead(normalizeInboundLead(ghl({ attributionSource: { formId: "EW_MASTER" } })), { activityBody: "t" });
    expect(deliverLeadToOwner).not.toHaveBeenCalled();
    expect(tryFulfillForNewLead).toHaveBeenCalledWith("L1");
  });
});
