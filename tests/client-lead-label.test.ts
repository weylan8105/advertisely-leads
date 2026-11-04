import { describe, it, expect, vi, beforeEach } from "vitest";

// A lead from a client's own campaign is titled with the client's name, not one
// of our funnels — even when the client's team member is the one who receives it.

const updates: any[] = [];
let storedRaw: unknown = { full_name: "Pat Lineman", lead_source: "abca-quiz" };
let owner: any = { email: "client@gmail.com", name: "Jace Jensen", defaultOrganizationId: null, ownedOrganizations: [] };

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => owner),
      updateMany: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(async () => ({ state: "TX", rawFormData: storedRaw })),
      updateMany: vi.fn(async (args: any) => {
        updates.push(args);
        return { count: 1 };
      }),
    },
    leadActivity: { create: vi.fn() },
    integration: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/email", () => ({ isEmailConfigured: false, sendLeadDeliveryEmail: vi.fn() }));
const advertiserTeamRecipient = vi.fn(async (): Promise<any> => null);
vi.mock("@/lib/advertiserVolume", () => ({ advertiserTeamRecipient }));

beforeEach(() => {
  updates.length = 0;
  storedRaw = { full_name: "Pat Lineman", lead_source: "abca-quiz" };
  owner = { email: "client@gmail.com", name: "Jace Jensen", defaultOrganizationId: null, ownedOrganizations: [] };
  advertiserTeamRecipient.mockClear();
  advertiserTeamRecipient.mockResolvedValue(null);
});

describe("client lead title", () => {
  it("uses the client's name over the funnel and import titles", async () => {
    const { leadOriginLabel, FUNNEL_LEAD_LABEL, IMPORT_LEAD_LABEL } = await import("@/lib/leadOrigin");
    expect(leadOriginLabel("abca-quiz", { advertiser_name: "Jace Jensen" })).toBe("Jace Jensen Lead");
    expect(leadOriginLabel("Jace form", { advertiser_name: "Jace Jensen" })).toBe("Jace Jensen Lead");
    expect(leadOriginLabel("abca-quiz", {})).toBe(FUNNEL_LEAD_LABEL);
    expect(leadOriginLabel("Meta - EW form", {})).toBe(IMPORT_LEAD_LABEL);
  });

  it("stamps the client's name on delivery and keeps the form answers", async () => {
    const { deliverLeadToOwner } = await import("@/lib/house");
    const { leadOriginLabel } = await import("@/lib/leadOrigin");
    await deliverLeadToOwner("L1", "JACE", "t");
    const raw = updates[0].data.rawFormData;
    expect(raw.full_name).toBe("Pat Lineman");
    expect(leadOriginLabel("abca-quiz", raw)).toBe("Jace Jensen Lead");
  });

  it("keeps the client's name when a teammate receives the lead", async () => {
    advertiserTeamRecipient.mockResolvedValue({ userId: "TEAMMATE", byQuota: true });
    const { deliverLeadToOwner } = await import("@/lib/house");
    await deliverLeadToOwner("L1", "JACE", "t");
    expect(updates[0].data.assignedUserId).toBe("TEAMMATE");
    expect(updates[0].data.rawFormData.advertiser_name).toBe("Jace Jensen");
  });

  it("falls back to the client's email when they have no name", async () => {
    owner = { ...owner, name: null };
    storedRaw = null;
    const { deliverLeadToOwner } = await import("@/lib/house");
    await deliverLeadToOwner("L1", "JACE", "t");
    expect(updates[0].data.rawFormData).toEqual({ advertiser_name: "client@gmail.com" });
  });
});
