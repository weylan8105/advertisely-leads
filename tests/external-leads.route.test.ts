import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for GET /api/external/leads (SignalDesk lead sync) — mocked prisma +
 * mocked API-key auth with SYNTHETIC data. Never touches a real DB/production.
 * Proves the pre-deployment checklist: auth 401/403, no cross-account access,
 * cursor paging without dup/skip, updated_since filtering, updated_at present,
 * conversions endpoint still works, and no credentials leak into responses.
 */

const leadStore = { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() };
const prismaMock = { lead: leadStore, $queryRaw: vi.fn() };

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));

const authenticateApiKey = vi.fn();
vi.mock("@/lib/apikey", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKey(...a),
  hasScope: (key: { scopes: string[] }, scope: string) => key.scopes.includes(scope) || key.scopes.includes("*"),
}));

vi.mock("@/lib/metaCapi", () => ({ fireMetaPurchaseEvent: vi.fn() }));

import { GET } from "@/app/api/external/leads/route";
import { GET as conversionsGET } from "@/app/api/conversions/route";

function req(url: string) {
  return new Request(url) as unknown as Parameters<typeof GET>[0];
}
const LEADS_KEY = { id: "k1", name: "signaldesk", scopes: ["leads:read"] };
const CONV_KEY = { id: "k2", name: "reader", scopes: ["conversions:read"] };

function lead(o: Record<string, unknown> = {}) {
  return {
    id: "lead_1", name: "Marcus Delgado", email: "m@example.test", phone: "+15550000001",
    state: "TX", status: "NEW", pipelineStage: "new-lead", source: "early-retirement-quiz",
    campaignName: "IUL Blue Collar", adsetId: "as_1", creativeId: "cr_1",
    utmSource: "fb", utmMedium: "cpc", utmCampaign: "iul", fbclid: "fb.1.abc",
    assignedUserId: "u_1", soldAt: null, soldPremiumCents: null, organizationId: "org_1",
    externalId: null, rawFormData: { landing_url: "https://x/lp", utm_content: "ad-a" },
    receivedAt: new Date("2026-09-01T00:00:00.000Z"), updatedAt: new Date("2026-09-10T00:00:00.000Z"),
    assignedUser: { name: "Agent A" }, ...o,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/external/leads", () => {
  it("401 with no/invalid key", async () => {
    authenticateApiKey.mockResolvedValue(null);
    expect((await GET(req("https://x/api/external/leads"))).status).toBe(401);
  });

  it("403 when key lacks leads:read", async () => {
    authenticateApiKey.mockResolvedValue(CONV_KEY);
    const res = await GET(req("https://x/api/external/leads"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("leads:read");
  });

  it("200 + full documented field set for a valid key", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([lead()]);
    const res = await GET(req("https://x/api/external/leads"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(1);
    const l = body.leads[0];
    // name split + relations + mapped ids
    expect(l).toMatchObject({
      id: "lead_1", account_id: "org_1", organization_id: "org_1",
      first_name: "Marcus", last_name: "Delgado", full_name: "Marcus Delgado",
      stage_id: "new-lead", stage_name: "New Lead (Form Submitted)",
      assigned_user_id: "u_1", assigned_user_name: "Agent A",
      ad_set_id: "as_1", ad_id: "cr_1", landing_page_url: "https://x/lp", utm_content: "ad-a",
      conversion_status: "open", conversion_date: null, monetary_value: null, currency: null,
    });
    // every required field is present (null rather than omitted where unavailable)
    for (const f of ["campaign_id", "ad_set_name", "ad_name", "form_id", "utm_term"]) {
      expect(f in l).toBe(true);
    }
    // updated_at + created_at are RFC3339
    expect(l.updated_at).toBe("2026-09-10T00:00:00.000Z");
    expect(l.created_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("maps a converted lead's money + status", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([lead({ pipelineStage: "issued-paid", soldPremiumCents: 120000, soldAt: new Date("2026-09-12T00:00:00.000Z") })]);
    const l = (await (await GET(req("https://x/api/external/leads"))).json()).leads[0];
    expect(l).toMatchObject({ conversion_status: "converted", monetary_value: "1200.00", currency: "USD", conversion_date: "2026-09-12T00:00:00.000Z" });
  });

  it("orders by (updatedAt,id) asc, pages with take=limit+1, returns next_cursor + has_more", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([
      lead({ id: "a", updatedAt: new Date("2026-09-10T00:00:00.000Z") }),
      lead({ id: "b", updatedAt: new Date("2026-09-11T00:00:00.000Z") }),
    ]);
    const res = await GET(req("https://x/api/external/leads?limit=1"));
    const body = await res.json();
    const arg = leadStore.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ updatedAt: "asc" }, { id: "asc" }]);
    expect(arg.take).toBe(2);
    expect(body.count).toBe(1);
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe("string");
    // the cursor is opaque + reversible to the last returned row's sort key
    const decoded = JSON.parse(Buffer.from(body.next_cursor, "base64url").toString("utf8"));
    expect(decoded).toEqual({ t: "2026-09-10T00:00:00.000Z", id: "a" });
  });

  it("cursor continues with a keyset predicate (no dup/skip); invalid cursor -> 400", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([]);
    const cursor = Buffer.from(JSON.stringify({ t: "2026-09-10T00:00:00.000Z", id: "a" }), "utf8").toString("base64url");
    await GET(req(`https://x/api/external/leads?cursor=${cursor}`));
    const where = leadStore.findMany.mock.calls[0][0].where;
    const keyset = where.AND.find((c: any) => c.OR)?.OR;
    expect(keyset[0]).toEqual({ updatedAt: { gt: new Date("2026-09-10T00:00:00.000Z") } });
    expect(keyset[1].AND[1]).toEqual({ id: { gt: "a" } });
    expect((await GET(req("https://x/api/external/leads?cursor=%%bad%%"))).status).toBe(400);
  });

  it("updated_since filters updatedAt>=; invalid -> 400", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([]);
    await GET(req("https://x/api/external/leads?updated_since=2026-09-01T00:00:00.000Z"));
    const where = leadStore.findMany.mock.calls[0][0].where;
    const clause = where.AND.find((c: any) => c.updatedAt)?.updatedAt;
    expect(clause.gte instanceof Date).toBe(true);
    expect((await GET(req("https://x/api/external/leads?updated_since=nope"))).status).toBe(400);
  });

  it("never accepts an account_id from the request (no cross-account access)", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([]);
    await GET(req("https://x/api/external/leads?account_id=someone_else&organization_id=other"));
    const where = leadStore.findMany.mock.calls[0][0].where;
    // the where clause must not carry any org/account filter sourced from the request
    expect(JSON.stringify(where)).not.toContain("organizationId");
    expect(JSON.stringify(where)).not.toContain("someone_else");
    expect(JSON.stringify(where)).not.toContain("other");
  });

  it("response carries no credential-like fields", async () => {
    authenticateApiKey.mockResolvedValue(LEADS_KEY);
    leadStore.findMany.mockResolvedValue([lead()]);
    const text = JSON.stringify(await (await GET(req("https://x/api/external/leads"))).json());
    for (const bad of ["hashedKey", "password", "cookie", "authorization", "apiKey", "adv_live_sk_"]) {
      expect(text.toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });
});

describe("existing /api/conversions still works", () => {
  it("valid conversions:read key -> 200", async () => {
    authenticateApiKey.mockResolvedValue(CONV_KEY);
    leadStore.findMany.mockResolvedValue([]);
    const res = await conversionsGET(req("https://x/api/conversions?limit=1"));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
