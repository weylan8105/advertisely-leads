import { describe, it, expect, vi, beforeEach } from "vitest";

// pollMetaLeads with Graph (fetch), the database and ingest mocked — pins the
// lookback filter, pagination, per-form error isolation and dry-run behaviour.

const mappings = [
  { formId: "F1", formName: "Jace form", packageId: "blue-collar-iul", ownerUserId: "U1", fieldMapping: {}, pageConnection: { pageId: "P", pageAccessToken: "stored" } },
  { formId: "F2", formName: "Broken form", packageId: "blue-collar-iul", ownerUserId: null, fieldMapping: {}, pageConnection: { pageId: "P", pageAccessToken: "stored" } },
];
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: {
    metaFormMapping: { findMany: vi.fn(async () => mappings) },
    lead: { findMany: vi.fn(async () => [{ externalId: "L1" }]) },
  },
}));
vi.mock("@/lib/metaAds", () => ({ systemUserPageToken: vi.fn(async () => "page-token") }));
const ingestLeadFromFields = vi.fn(async (o: any) => (o.externalId === "L1" ? { status: "skipped_duplicate" } : { status: "ingested" }));
vi.mock("@/lib/leadIngest", () => ({ ingestLeadFromFields }));

const lead = (id: string) => ({ id, created_time: "2026-11-04T12:00:00+0000", form_id: "F1", field_data: [{ name: "full_name", values: ["Pat"] }] });
let urls: string[];

beforeEach(() => {
  urls = [];
  ingestLeadFromFields.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    urls.push(url);
    if (url.includes("/F2/")) return { ok: false, status: 400, json: async () => ({ error: { message: "no access" } }) } as Response;
    if (url.includes("after=cursor")) return { ok: true, json: async () => ({ data: [lead("L3")] }) } as Response;
    return { ok: true, json: async () => ({ data: [lead("L1"), lead("L2")], paging: { next: "https://graph.facebook.com/v20.0/F1/leads?after=cursor" } }) } as Response;
  }));
});

describe("pollMetaLeads", () => {
  it("pulls every page of recent leads, dedupes, and isolates a failing form", async () => {
    const { pollMetaLeads } = await import("@/lib/metaLeadPoll");
    const [f1, f2] = await pollMetaLeads();
    const filter = JSON.parse(new URL(urls[0]).searchParams.get("filtering")!);
    expect(filter[0]).toMatchObject({ field: "time_created", operator: "GREATER_THAN" });
    expect(new URL(urls[0]).searchParams.get("access_token")).toBe("page-token");
    expect(f1).toMatchObject({ found: 3, ingested: 2, duplicates: 1, skipped: 0 });
    expect(ingestLeadFromFields).toHaveBeenCalledWith(expect.objectContaining({ externalId: "L2", ownerUserId: "U1", flat: { full_name: "Pat" } }));
    expect(f2).toMatchObject({ found: 0, error: "no access" });
  });

  it("dry run lists ids and what's already stored without ingesting", async () => {
    const { pollMetaLeads } = await import("@/lib/metaLeadPoll");
    const [f1] = await pollMetaLeads({ dryRun: true });
    expect(ingestLeadFromFields).not.toHaveBeenCalled();
    expect(f1.leads?.map((l) => [l.id, l.known])).toEqual([["L1", true], ["L2", false], ["L3", false]]);
  });
});
