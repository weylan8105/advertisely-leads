import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Characterization + behavior tests for /api/conversions.
 *
 * These run entirely against MOCKED prisma + MOCKED Meta CAPI with SYNTHETIC
 * data — never a real database and never production. Their job:
 *   1. Lock in the existing POST contract so a future refactor can't silently
 *      change it (auth, validation, side effects, response shape, idempotency).
 *   2. Prove the new GET sync feed paginates and stays backward-compatible.
 */

// ── Mocks ────────────────────────────────────────────────────────────
const leadStore = {
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  update: vi.fn(),
};
const prismaMock = { lead: leadStore, $queryRaw: vi.fn() };

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() {
    return prismaMock;
  },
}));

const authenticateApiKey = vi.fn();
vi.mock("@/lib/apikey", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKey(...a),
  hasScope: (key: { scopes: string[] }, scope: string) =>
    key.scopes.includes(scope) || key.scopes.includes("*"),
}));

const fireMetaPurchaseEvent = vi.fn();
vi.mock("@/lib/metaCapi", () => ({
  fireMetaPurchaseEvent: (...a: unknown[]) => fireMetaPurchaseEvent(...a),
}));

import { GET, POST } from "@/app/api/conversions/route";

// ── Helpers ──────────────────────────────────────────────────────────
function req(url: string, init?: RequestInit) {
  return new Request(url, init) as unknown as Parameters<typeof GET>[0];
}
const READ_KEY = { id: "k1", name: "reader", scopes: ["conversions:read"] };
const WRITE_KEY = { id: "k2", name: "writer", scopes: ["conversions:write"] };

function lead(overrides: Record<string, unknown> = {}) {
  return {
    id: "lead_1",
    name: "Synthetic Person",
    email: "synthetic@example.test",
    phone: "+15550000001",
    state: "TX",
    packageId: "blue-collar-iul",
    pipelineStage: "issued-paid",
    status: "CLOSED",
    soldAt: new Date("2026-09-10T12:00:00.000Z"),
    soldPremiumCents: 120000,
    source: "early-retirement-quiz",
    campaignName: "IUL BlueCollar",
    adsetId: "as_1",
    creativeId: "cr_1",
    utmSource: "fb",
    utmMedium: "cpc",
    utmCampaign: "iul",
    fbclid: "fb.1.abc",
    receivedAt: new Date("2026-09-01T00:00:00.000Z"),
    assignedAt: new Date("2026-09-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── POST /api/conversions — characterization (behavior must NOT change) ──
describe("POST /api/conversions (characterization)", () => {
  it("401 when no/invalid key", async () => {
    authenticateApiKey.mockResolvedValue(null);
    const res = await POST(req("https://x/api/conversions", { method: "POST", body: "[]" }));
    expect(res.status).toBe(401);
  });

  it("403 when key lacks conversions:write", async () => {
    authenticateApiKey.mockResolvedValue(READ_KEY); // read-only cannot write
    const res = await POST(
      req("https://x/api/conversions", { method: "POST", body: JSON.stringify({ leadId: "lead_1" }) }),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("conversions:write");
  });

  it("400 on invalid JSON", async () => {
    authenticateApiKey.mockResolvedValue(WRITE_KEY);
    const res = await POST(req("https://x/api/conversions", { method: "POST", body: "not json" }));
    expect(res.status).toBe(400);
  });

  it("400 on empty array or >500 items", async () => {
    authenticateApiKey.mockResolvedValue(WRITE_KEY);
    const empty = await POST(req("https://x/api/conversions", { method: "POST", body: "[]" }));
    expect(empty.status).toBe(400);
    const tooMany = await POST(
      req("https://x/api/conversions", {
        method: "POST",
        body: JSON.stringify(Array.from({ length: 501 }, () => ({ leadId: "l" }))),
      }),
    );
    expect(tooMany.status).toBe(400);
  });

  it("item without leadId/email/phone is unmatched, response ok", async () => {
    authenticateApiKey.mockResolvedValue(WRITE_KEY);
    const res = await POST(req("https://x/api/conversions", { method: "POST", body: JSON.stringify([{}]) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, recorded: 0, unmatched: 1 });
  });

  it("valid conversion marks lead issued-paid + CLOSED, sets premium, fires Meta Purchase", async () => {
    authenticateApiKey.mockResolvedValue(WRITE_KEY);
    leadStore.findUnique.mockResolvedValue(lead({ pipelineStage: "new-lead", status: "NEW", soldPremiumCents: null }));
    leadStore.update.mockResolvedValue({});
    const res = await POST(
      req("https://x/api/conversions", {
        method: "POST",
        body: JSON.stringify({ leadId: "lead_1", value: 1200, event: "issued" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, recorded: 1, unmatched: 0 });

    const updateArg = leadStore.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "lead_1" });
    expect(updateArg.data.pipelineStage).toBe("issued-paid");
    expect(updateArg.data.status).toBe("CLOSED");
    expect(updateArg.data.soldPremiumCents).toBe(120000); // 1200 dollars -> cents
    expect(fireMetaPurchaseEvent).toHaveBeenCalledWith("lead_1", 120000);
  });

  it("unmatched lead reported without throwing", async () => {
    authenticateApiKey.mockResolvedValue(WRITE_KEY);
    leadStore.findUnique.mockResolvedValue(null);
    const res = await POST(
      req("https://x/api/conversions", { method: "POST", body: JSON.stringify({ leadId: "missing" }) }),
    );
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, recorded: 0, unmatched: 1 });
  });

  it("current idempotency behavior: re-posting the same conversion writes again (documented, not deduped)", async () => {
    authenticateApiKey.mockResolvedValue(WRITE_KEY);
    leadStore.findUnique.mockResolvedValue(lead());
    leadStore.update.mockResolvedValue({});
    await POST(req("https://x/api/conversions", { method: "POST", body: JSON.stringify({ leadId: "lead_1", value: 1200 }) }));
    await POST(req("https://x/api/conversions", { method: "POST", body: JSON.stringify({ leadId: "lead_1", value: 1200 }) }));
    expect(leadStore.update).toHaveBeenCalledTimes(2);
    expect(fireMetaPurchaseEvent).toHaveBeenCalledTimes(2);
  });
});

// ── GET /api/conversions — legacy shape stays intact ──
describe("GET /api/conversions (legacy contract preserved)", () => {
  it("401 without key; 403 without conversions:read", async () => {
    authenticateApiKey.mockResolvedValueOnce(null);
    expect((await GET(req("https://x/api/conversions"))).status).toBe(401);
    authenticateApiKey.mockResolvedValueOnce(WRITE_KEY); // write scope != read scope
    expect((await GET(req("https://x/api/conversions"))).status).toBe(403);
  });

  it("default response keeps { ok, count, conversions } and desc order", async () => {
    authenticateApiKey.mockResolvedValue(READ_KEY);
    leadStore.findMany.mockResolvedValue([lead(), lead({ id: "lead_2" })]);
    const res = await GET(req("https://x/api/conversions"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.count).toBe(2);
    expect(Array.isArray(body.conversions)).toBe(true);
    // findMany called with soldAt desc, default converted filter, limit 200
    const arg = leadStore.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual({ soldAt: "desc" });
    expect(arg.where.pipelineStage).toBe("issued-paid");
    expect(arg.take).toBe(200);
    // additive fields present, legacy fields intact
    expect(body.conversions[0]).toMatchObject({ converted: true, valueCents: 120000, currency: "USD" });
    expect(body.conversions[0].event_time).toBe("2026-09-10T12:00:00.000Z");
    expect(body.conversions[0].value_decimal).toBe("1200.00");
  });
});

// ── GET /api/conversions — new sync feed ──
describe("GET /api/conversions?mode=sync (incremental feed)", () => {
  it("orders by (soldAt,id) asc, returns next_cursor + has_more when a page is full", async () => {
    authenticateApiKey.mockResolvedValue(READ_KEY);
    // limit=1 -> handler fetches take=2 to detect more; return 2 rows
    leadStore.findMany.mockResolvedValue([
      lead({ id: "a", soldAt: new Date("2026-09-10T12:00:00.000Z") }),
      lead({ id: "b", soldAt: new Date("2026-09-11T12:00:00.000Z") }),
    ]);
    const res = await GET(req("https://x/api/conversions?mode=sync&limit=1"));
    const body = await res.json();
    const arg = leadStore.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ soldAt: "asc" }, { id: "asc" }]);
    expect(arg.take).toBe(2);
    expect(body.count).toBe(1);
    expect(body.has_more).toBe(true);
    expect(typeof body.next_cursor).toBe("string");
    expect(body.max_page_size).toBe(1000);
  });

  it("invalid cursor -> 400", async () => {
    authenticateApiKey.mockResolvedValue(READ_KEY);
    const res = await GET(req("https://x/api/conversions?cursor=%%%notbase64%%%"));
    expect(res.status).toBe(400);
  });

  it("updated_since filters soldAt >= given time and applies keyset on cursor", async () => {
    authenticateApiKey.mockResolvedValue(READ_KEY);
    leadStore.findMany.mockResolvedValue([]);
    await GET(req("https://x/api/conversions?updated_since=2026-09-01T00:00:00Z"));
    const arg = leadStore.findMany.mock.calls[0][0];
    // where is AND[ {converted filter}, { soldAt: { not:null, gte: Date } } ]
    const soldClause = arg.where.AND.find((c: any) => c.soldAt)?.soldAt;
    expect(soldClause.not).toBe(null);
    expect(soldClause.gte instanceof Date).toBe(true);
  });

  it("invalid updated_since -> 400", async () => {
    authenticateApiKey.mockResolvedValue(READ_KEY);
    const res = await GET(req("https://x/api/conversions?updated_since=not-a-date"));
    expect(res.status).toBe(400);
  });
});
