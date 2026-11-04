import { describe, it, expect, vi, beforeEach } from "vitest";

// ingestLeadFromFields with the database and delivery mocked — pins which
// missing fields drop a Meta form lead.

const created: any[] = [];
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: {
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
  },
}));
const deliverLeadToOwner = vi.fn(async () => true);
vi.mock("@/lib/house", () => ({ deliverLeadToOwner }));
vi.mock("@/lib/fulfillment", () => ({ tryFulfillForNewLead: vi.fn() }));

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
  deliverLeadToOwner.mockClear();
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
});
