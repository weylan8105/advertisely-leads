import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for POST /api/quiz/submit (keyless ABCA quiz intake) and the refactored
 * POST /api/webhooks/inbound — mocked prisma, fulfillment and Meta CAPI with
 * SYNTHETIC data. Never touches a real DB/production.
 */

const prismaMock = {
  funnelEvent: { findMany: vi.fn() },
  lead: { findFirst: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  leadActivity: { create: vi.fn() },
};

vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));

const tryFulfillForNewLead = vi.fn();
vi.mock("@/lib/fulfillment", () => ({ tryFulfillForNewLead: (...a: unknown[]) => tryFulfillForNewLead(...a) }));
const fireMetaLeadEvent = vi.fn();
vi.mock("@/lib/metaCapi", () => ({ fireMetaLeadEvent: (...a: unknown[]) => fireMetaLeadEvent(...a) }));

const authenticateApiKey = vi.fn();
vi.mock("@/lib/apikey", () => ({
  authenticateApiKey: (...a: unknown[]) => authenticateApiKey(...a),
  hasScope: (key: { scopes: string[] }, scope: string) => key.scopes.includes(scope),
}));

import { POST } from "@/app/api/quiz/submit/route";
import { POST as inboundPOST } from "@/app/api/webhooks/inbound/route";

type Req = Parameters<typeof POST>[0];
let ipSeq = 0;

function submit(body: unknown, opts: { ip?: string; origin?: string | null; contentType?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": opts.contentType ?? "application/json",
    host: "www.americanbluecollaradvantage.com",
    "x-real-ip": opts.ip ?? `203.0.113.${++ipSeq}`,
  };
  if (opts.origin !== null) headers.origin = opts.origin ?? "https://www.americanbluecollaradvantage.com";
  return POST(new Request("https://www.americanbluecollaradvantage.com/api/quiz/submit", {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as Req);
}

function payload(o: Record<string, unknown> = {}) {
  return {
    first_name: "Marcus", last_name: "Delgado", full_name: "Marcus Delgado",
    phone: "(512) 555-0142", email: "marcus@mailbox.example.org", state: "TX", zip: "78701",
    quiz_beneficiary: "Spouse", quiz_iul_interest: "Help understanding all of these", quiz_age: "41",
    quiz_coverage: "$250,000 to $500,000", quiz_lead_tier: "HOT",
    consent_given: "Yes", consent_timestamp: "2026-10-20T12:00:00.000Z", consent_language: "By checking here...", consent_ip: "198.51.100.7",
    event_name: "Lead", event_id: "ev_1760961600000_abc123de", fbc: "", fbp: "fb.1.1.1", fbclid: "",
    utm_source: "fb", utm_campaign: "abca", utm_content: "", landing_url: "https://www.americanbluecollaradvantage.com/",
    lead_source: "early-retirement-quiz", submitted_at: "2026-10-20T12:00:00.000Z",
    name: "Marcus Delgado", age: "41", intent: "Help understanding all of these", source: "early-retirement-quiz",
    external_id: "ev_1760961600000_abc123de", session_id: "s_mgz1abcd_k3j4h5g6", hp_check: "",
    ...o,
  };
}

const ago = (ms: number) => new Date(Date.now() - ms);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.funnelEvent.findMany.mockResolvedValue([
    { type: "view", createdAt: ago(90_000) },
    { type: "step", createdAt: ago(80_000) },
  ]);
  prismaMock.lead.findFirst.mockResolvedValue(null);
  prismaMock.lead.count.mockResolvedValue(0);
  prismaMock.lead.findUnique.mockResolvedValue(null);
  prismaMock.lead.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: "lead_new", ...data }));
});

describe("POST /api/quiz/submit", () => {
  it("creates a lead from a valid quiz payload and runs fulfillment + Meta", async () => {
    const res = await submit(payload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(prismaMock.lead.create).toHaveBeenCalledTimes(1);
    const data = prismaMock.lead.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      name: "Marcus Delgado", phone: "(512) 555-0142", email: "marcus@mailbox.example.org",
      zip: "78701", state: "TX", source: "early-retirement-quiz", externalId: "ev_1760961600000_abc123de",
      consentIp: "198.51.100.7",
    });
    expect(data.rawFormData.session_id).toBe("s_mgz1abcd_k3j4h5g6");
    expect(data.rawFormData.server_ip).toMatch(/^203\.0\.113\./);
    expect(data.rawFormData.consent_language).toBe("By checking here...");
    expect(data.rawFormData).not.toHaveProperty("hp_check");
    expect(tryFulfillForNewLead).toHaveBeenCalledWith("lead_new");
    expect(fireMetaLeadEvent).toHaveBeenCalledTimes(1);
  });

  it("drops non-quiz fields so the public route can't steer routing", async () => {
    await submit(payload({ packageId: "some-other-package", tags: ["VIP"], customData: { a: 1 }, contact_id: "c1", source: "spoofed" }));
    const data = prismaMock.lead.create.mock.calls[0][0].data;
    expect(data.packageId).toBe("blue-collar-iul");
    expect(data.tags).toEqual([]);
    expect(data.source).toBe("early-retirement-quiz");
    expect(data.rawFormData).not.toHaveProperty("customData");
    expect(data.rawFormData).not.toHaveProperty("contact_id");
  });

  it("falls back to the observed IP for consent when the browser sent none", async () => {
    await submit(payload({ consent_ip: "" }), { ip: "192.0.2.55" });
    expect(prismaMock.lead.create.mock.calls[0][0].data.consentIp).toBe("192.0.2.55");
  });

  it("rejects a filled or missing honeypot without creating a lead", async () => {
    expect((await submit(payload({ hp_check: "http://spam" }))).status).toBe(400);
    const { hp_check, ...noHp } = payload();
    void hp_check;
    expect((await submit(noHp)).status).toBe(400);
    expect(prismaMock.lead.create).not.toHaveBeenCalled();
  });

  it("validates name/phone/email/zip/consent/session/event id", async () => {
    const res = await submit(payload({
      full_name: "Marcus", name: "Marcus", phone: "555-0142", email: "nope", zip: "787",
      consent_given: "", session_id: "x", event_id: "1",
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).fields).toEqual(["name", "phone", "email", "zip", "consent_given", "session_id", "event_id"]);
    expect(prismaMock.lead.create).not.toHaveBeenCalled();
  });

  it("accepts an 11-digit phone with a leading 1", async () => {
    await submit(payload({ phone: "+1 512 555 0142" }));
    expect(prismaMock.lead.create.mock.calls[0][0].data.phone).toBe("(512) 555-0142");
  });

  it("requires a recent funnel view + step for the session", async () => {
    prismaMock.funnelEvent.findMany.mockResolvedValueOnce([]);
    expect((await submit(payload())).status).toBe(403);
    prismaMock.funnelEvent.findMany.mockResolvedValueOnce([{ type: "view", createdAt: ago(90_000) }]);
    expect((await submit(payload())).status).toBe(403);
    prismaMock.funnelEvent.findMany.mockResolvedValueOnce([
      { type: "view", createdAt: ago(2_000) }, { type: "step", createdAt: ago(1_000) },
    ]);
    expect((await submit(payload())).status).toBe(403); // faster than a human
    expect(prismaMock.lead.create).not.toHaveBeenCalled();
  });

  it("returns 2xx without a new lead for a repeat session/phone", async () => {
    prismaMock.lead.findFirst.mockResolvedValueOnce({ id: "lead_old" });
    const res = await submit(payload());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(prismaMock.lead.create).not.toHaveBeenCalled();
  });

  it("caps quiz leads per IP per day", async () => {
    prismaMock.lead.count.mockResolvedValueOnce(3);
    expect((await submit(payload())).status).toBe(429);
    expect(prismaMock.lead.create).not.toHaveBeenCalled();
  });

  it("limits bursts from one IP", async () => {
    prismaMock.funnelEvent.findMany.mockResolvedValue([]); // cheap 403s; we only count requests
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await submit(payload(), { ip: "198.51.100.200" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 403)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it("blocks cross-origin browser posts and non-JSON bodies", async () => {
    expect((await submit(payload(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await submit(payload(), { origin: null })).status).toBe(200); // server-to-server: other checks apply
    expect((await submit(JSON.stringify(payload()), { contentType: "text/plain" })).status).toBe(415);
  });

  it("auto-trashes test identities and still answers 2xx", async () => {
    const res = await submit(payload({ full_name: "Test Person", name: "Test Person", email: "qa@example.com" }));
    expect(res.status).toBe(200);
    expect(prismaMock.lead.update).toHaveBeenCalledWith(expect.objectContaining({ data: { trashedAt: expect.any(Date) } }));
    expect(tryFulfillForNewLead).not.toHaveBeenCalled();
    expect(fireMetaLeadEvent).not.toHaveBeenCalled();
  });

  it("answers 500 when the lead can't be saved", async () => {
    prismaMock.lead.create.mockRejectedValueOnce(new Error("db down"));
    expect((await submit(payload())).status).toBe(500);
  });
});

describe("POST /api/webhooks/inbound (shared intake)", () => {
  function inbound(body: unknown) {
    return inboundPOST(new Request("https://advertisely.io/api/webhooks/inbound", {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": "k" }, body: JSON.stringify(body),
    }) as unknown as Req);
  }

  it("still requires a leads:write key", async () => {
    authenticateApiKey.mockResolvedValue(null);
    expect((await inbound({ phone: "5125550142" })).status).toBe(401);
    authenticateApiKey.mockResolvedValue({ id: "k", name: "reader", scopes: ["leads:read"] });
    expect((await inbound({ phone: "5125550142" })).status).toBe(401);
  });

  it("counts created / no-phone / duplicate / test leads as before", async () => {
    authenticateApiKey.mockResolvedValue({ id: "k", name: "Make", scopes: ["leads:write"] });
    prismaMock.lead.findUnique.mockImplementation(async ({ where }: { where: { externalId: string } }) =>
      where.externalId === "dup" ? { id: "old" } : null);
    const res = await inbound([
      { name: "Ana Ruiz", phone: "5125550142", email: "ana@mailbox.example.org", external_id: "x1" },
      { name: "No Phone", email: "np@mailbox.example.org" },
      { name: "Dup Lead", phone: "5125550143", external_id: "dup" },
      { name: "Test Lead", phone: "5125550144", external_id: "x2" },
    ]);
    expect(await res.json()).toEqual({ ok: true, created: 1, skipped: 3, errors: ["Skipped a lead with no phone number."] });
    expect(tryFulfillForNewLead).toHaveBeenCalledTimes(1);
    expect(prismaMock.lead.create.mock.calls[0][0].data.activity.create.body).toBe(
      "Lead received via inbound connector (Facebook instant form).",
    );
  });
});
