import { describe, it, expect, vi, beforeEach } from "vitest";

// ingestLeadFromFields with the database and delivery mocked — pins which
// missing fields drop a Meta form lead.

const created: any[] = [];
const copies: any[] = [];
const update = vi.fn();
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
      update,
    },
    leadActivity: { create: vi.fn() },
  },
}));
const deliverLeadToOwner = vi.fn(async () => true);
vi.mock("@/lib/house", () => ({ deliverLeadToOwner }));
vi.mock("@/lib/fulfillment", () => ({ tryFulfillForNewLead: vi.fn() }));
const fireMetaLeadEvent = vi.fn(async () => undefined);
vi.mock("@/lib/metaCapi", () => ({ fireMetaLeadEvent }));

const base = {
  // Not an @example.com / "test" identity — those are auto-trashed on intake.
  flat: { full_name: "Pat Lineman", phone_number: "+15555550123", email: "pat.lineman@gmail.com" },
  fieldMapping: {},
  packageId: "blue-collar-iul",
  source: "Meta - Client form",
  activityBody: "test",
};

beforeEach(() => {
  created.length = 0;
  copies.length = 0;
  update.mockClear();
  deliverLeadToOwner.mockClear();
  fireMetaLeadEvent.mockClear();
});

describe("ingestLeadFromFields", () => {
  it("delivers an advertiser's form lead even when the form asks no state", async () => {
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    const r = await ingestLeadFromFields({ ...base, externalId: "lg1", ownerUserId: "U1" });
    expect(r.status).toBe("ingested");
    expect(created[0]).toMatchObject({ state: "", name: "Pat Lineman" });
    expect(deliverLeadToOwner).toHaveBeenCalledWith("L1", "U1", expect.any(String));
  });

  it("still requires a state for marketplace leads", async () => {
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    const r = await ingestLeadFromFields({ ...base, externalId: "lg2" });
    expect(r).toMatchObject({ status: "missing_fields", missing: ["state"] });
    expect(created).toHaveLength(0);
  });

  it("keeps a Meta ZIP answer and derives the state from it", async () => {
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    const r = await ingestLeadFromFields({ ...base, flat: { ...base.flat, zip_code: "33101-1234" }, externalId: "lg3" });
    expect(r.status).toBe("ingested");
    expect(created[0]).toMatchObject({ zip: "33101", state: "FL" });
  });

  const fromMeta = {
    ...base,
    flat: { ...base.flat, state: "FL" },
    meta: { formId: "F1", campaignId: "C1", campaignName: "Lineman Q4", adId: "A1", createdTime: new Date() },
  };

  it("stores what GHL leads carry: campaign name, form and Meta ids", async () => {
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    await ingestLeadFromFields({ ...fromMeta, externalId: "lg4" });
    expect(created[0]).toMatchObject({ campaignName: "Lineman Q4", utmCampaign: "Lineman Q4", creativeId: "A1" });
    expect(created[0].rawFormData).toMatchObject({ form_id: "F1", leadgen_id: "lg4", campaignId: "C1" });
  });

  it("tells Meta about our own leads, but not an advertiser's or a simulation", async () => {
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    await ingestLeadFromFields({ ...fromMeta, externalId: "lg5" });
    expect(fireMetaLeadEvent).toHaveBeenCalledTimes(1);
    await ingestLeadFromFields({ ...fromMeta, externalId: "lg6", ownerUserId: "U1" });
    await ingestLeadFromFields({ ...base, flat: fromMeta.flat, externalId: "lg7" });
    expect(fireMetaLeadEvent).toHaveBeenCalledTimes(1);
  });

  it("skips a lead GHL already stored and keeps Meta's id on that copy", async () => {
    copies.push({ id: "G1", rawFormData: { attributionSource: "F1" } });
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    const r = await ingestLeadFromFields({ ...fromMeta, externalId: "lg8", ownerUserId: "U1" });
    expect(r).toMatchObject({ status: "skipped_duplicate", leadId: "G1" });
    expect(created).toHaveLength(0);
    expect(deliverLeadToOwner).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { id: "G1" },
      data: { rawFormData: { attributionSource: "F1", leadgen_id: "lg8" } },
    });
  });

  it("builds the name from first and last when the form splits them", async () => {
    const { ingestLeadFromFields } = await import("@/lib/leadIngest");
    const flat = { first_name: "Pat", last_name: "Lineman", phone_number: "+15555550123", state: "FL" };
    await ingestLeadFromFields({ ...base, flat, externalId: "lg9" });
    expect(created[0].name).toBe("Pat Lineman");
  });
});
