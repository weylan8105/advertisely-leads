import { describe, it, expect, vi, beforeEach } from "vitest";

// Instant form leads report to Meta in its Conversion Leads format, and every
// send's outcome is kept so a dropped event can be traced.

vi.hoisted(() => {
  process.env.META_CAPI_ACCESS_TOKEN = "capi-token";
  process.env.META_ADS_ACCESS_TOKEN = "system-user-token";
});

const leads = new Map<string, any>();
const mappings = new Map<string, any>();
const pages: any[] = [];
const logged: any[] = [];
const updates: any[] = [];

vi.mock("../lib/prisma", () => {
  const prisma = {
    lead: {
      findUnique: vi.fn(async ({ where }: any) => leads.get(where.id) ?? null),
      update: vi.fn(async (args: any) => {
        updates.push(args);
        return {};
      }),
    },
    metaFormMapping: { findUnique: vi.fn(async ({ where }: any) => mappings.get(where.formId) ?? null) },
    metaPageConnection: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => pages) },
    funnelEvent: {
      create: vi.fn(async ({ data }: any) => {
        logged.push(data);
        return {};
      }),
      findMany: vi.fn(async ({ where }: any) =>
        logged.filter((l) => l.source === "meta-capi" && l.cta.startsWith(where.cta.startsWith) && l.cta.includes(where.cta.contains)),
      ),
    },
  };
  return { isDatabaseConfigured: true, prisma };
});

import { fireMetaLeadEvent, fireMetaStageEvent, fireMetaPurchaseEvent } from "../lib/metaCapi";
import { instantFormContext, adColumnsToFill, fillLeadAd } from "../lib/metaLeadId";

const FORM = "1721027025846342";
const META_ID = "1234567890123456789".slice(0, 17);
const attribution = JSON.stringify({ formId: FORM, adId: "1", adSetId: "2" });

const instantLead = (over: Record<string, unknown> = {}) => ({
  id: "L1",
  externalId: "ghlContactAbc123",
  source: "Facebook instant form",
  name: "Pat Lineman",
  email: "pat@example.com",
  phone: "+1 (555) 555-0123",
  state: "TX",
  receivedAt: new Date(),
  rawFormData: { attributionSource: attribution },
  ...over,
});

const formLead = (over: Record<string, unknown> = {}) => ({
  id: META_ID,
  created_time: new Date().toISOString(),
  form_id: FORM,
  field_data: [
    { name: "email", values: ["PAT@example.com"] },
    { name: "phone_number", values: ["+15555550123"] },
  ],
  ...over,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let sent: { url: string; text: string; body: any }[];
let graph: { pageAccess: boolean; formLeads: any[]; leadAd: any; hang: boolean; capi: () => Response };

beforeEach(() => {
  leads.clear();
  mappings.clear();
  pages.length = 0;
  logged.length = 0;
  updates.length = 0;
  sent = [];
  graph = {
    pageAccess: true,
    formLeads: [formLead()],
    leadAd: { campaign_id: "120245300016060396", campaign_name: "Blue Collar ER", adset_id: "2200", ad_id: "3300" },
    hang: false,
    capi: () => json({ events_received: 1, messages: [], fbtrace_id: "x" }),
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: any, init?: any) => {
      const url = String(input);
      if (url.includes("/events?")) {
        sent.push({ url, text: init.body, body: JSON.parse(init.body) });
        return graph.capi();
      }
      if (graph.hang) return new Promise(() => {});
      if (url.includes(`/${FORM}/leads`)) return json({ data: graph.formLeads });
      if (url.includes(`/${META_ID}?`)) {
        return graph.leadAd ? json(graph.leadAd) : json({ error: { message: "no ad access" } }, 400);
      }
      if (url.includes(`/${FORM}?`)) {
        return graph.pageAccess ? json({ page: { id: "PAGE" } }) : json({ error: { message: "no access" } }, 400);
      }
      if (url.includes("/PAGE?")) return json({ access_token: "page-token" });
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
});

const event = () => sent[0].body.data[0];

describe("campaign and ad details from Meta", () => {
  const stored = (over: Record<string, unknown> = {}) =>
    instantLead({ rawFormData: { attributionSource: attribution, leadgen_id: META_ID }, ...over });

  it("fills the blanks GHL left when it finds the lead", async () => {
    await fireMetaLeadEvent(instantLead());
    expect(updates[0].data).toMatchObject({
      campaignName: "Blue Collar ER",
      utmCampaign: "Blue Collar ER",
      adsetId: "2200",
      creativeId: "3300",
    });
    expect(updates[0].data.rawFormData).toMatchObject({ leadgen_id: META_ID, campaignId: "120245300016060396" });
  });

  it("skips the extra call when GHL already sent them", async () => {
    await fireMetaLeadEvent(instantLead({ campaignName: "From GHL", creativeId: "9" }));
    const calls = (fetch as any).mock.calls.map((c: any[]) => String(c[0]));
    expect(calls.some((u: string) => u.includes(`/${META_ID}?`))).toBe(false);
    expect(updates[0].data.campaignName).toBeUndefined();
  });

  it("keeps the lead id and the form's ad ids when the ad lookup fails", async () => {
    graph.leadAd = null;
    graph.formLeads = [formLead({ ad_id: "3301", adset_id: "2201", campaign_id: "120245300016060397" })];
    const res = await fireMetaLeadEvent(instantLead());
    expect(res.ok).toBe(true);
    expect(sent[0].text).toContain(`"lead_id":${META_ID}`);
    expect(updates[0].data).toMatchObject({ adsetId: "2201", creativeId: "3301" });
    expect(updates[0].data.campaignName).toBeUndefined();
    expect(updates[0].data.rawFormData).toMatchObject({ leadgen_id: META_ID, campaignId: "120245300016060397" });
  });

  it("never replaces what's already on the lead", () => {
    const fill = adColumnsToFill(
      { campaignName: "Kept", utmCampaign: "", adsetId: "1", creativeId: null },
      { campaign_name: "Meta", adset_id: "2", ad_id: "3" },
    );
    expect(fill).toEqual({ utmCampaign: "Meta", creativeId: "3" });
  });

  it("fills a lead that already has its Meta id", async () => {
    const { fill } = await fillLeadAd(stored());
    expect(fill).toMatchObject({ campaignName: "Blue Collar ER", creativeId: "3300" });
    expect(updates[0].data.rawFormData).toMatchObject({ leadgen_id: META_ID, campaignId: "120245300016060396" });
  });

  it("writes nothing on a dry run", async () => {
    const { fill } = await fillLeadAd(stored(), { dryRun: true });
    expect(fill.creativeId).toBe("3300");
    expect(updates).toHaveLength(0);
  });

  it("says why when Meta won't share the ad", async () => {
    graph.leadAd = null;
    expect(await fillLeadAd(stored())).toEqual({ fill: {}, error: "no ad access" });
    expect(updates).toHaveLength(0);
  });

  it("does nothing without a stored Meta id", async () => {
    expect(await fillLeadAd(instantLead())).toEqual({ fill: {}, error: "no lead or form id" });
  });
});

describe("new instant form leads", () => {
  it("sends the first CRM stage with Meta's lead id and keeps the id", async () => {
    const res = await fireMetaLeadEvent(instantLead());
    expect(res.ok).toBe(true);
    expect(event().event_name).toBe("Contact");
    expect(event().action_source).toBe("system_generated");
    expect(event().custom_data).toEqual({ event_source: "crm", lead_event_source: "Advertisely" });
    // A bare number, digit for digit: as a JS number it would lose precision.
    expect(sent[0].text).toContain(`"lead_id":${META_ID}`);
    expect(updates[0].data.rawFormData).toMatchObject({ leadgen_id: META_ID, attributionSource: attribution });
    expect(logged[0].cta).toBe("ok Contact rcvd:1 id:found lead:L1");
    expect(logged[0].step).toBe(200);
  });

  it("never reports as a plain pixel Lead, which website ad sets optimize on", async () => {
    await fireMetaLeadEvent(instantLead());
    expect(sent.map((s) => s.body.data[0].event_name)).not.toContain("Lead");
  });

  it("matches on phone when the email differs, and takes the nearest submission", async () => {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const older = formLead({ id: "111111111111111", created_time: hourAgo });
    const stranger = formLead({ id: "222222222222222", field_data: [{ name: "email", values: ["x@y.com"] }] });
    graph.formLeads = [older, stranger, formLead()];
    await fireMetaLeadEvent(instantLead({ email: "other@example.com" }));
    expect(sent[0].text).toContain(`"lead_id":${META_ID}`);
  });

  it("still sends on email and phone when the form's Page is out of reach", async () => {
    graph.pageAccess = false;
    const res = await fireMetaLeadEvent(instantLead());
    expect(res.ok).toBe(true);
    expect(event().user_data.lead_id).toBeUndefined();
    expect(event().user_data.em).toHaveLength(1);
    expect(event().user_data.ph).toHaveLength(1);
    expect(event().custom_data.event_source).toBe("crm");
    expect(logged[0].cta).toContain("id:no-access");
  });

  it("falls back to a connected Page's token", async () => {
    graph.pageAccess = false;
    pages.push({ pageAccessToken: "connected-token" });
    await fireMetaLeadEvent(instantLead());
    expect(sent[0].text).toContain(`"lead_id":${META_ID}`);
  });

  it("doesn't hold a new lead up on a slow lookup", async () => {
    graph.hang = true;
    const ctx = await instantFormContext(instantLead(), 20);
    expect(ctx).toEqual({ note: "id:timeout" });
  });

  it("never treats a GHL contact id as a Meta lead id", async () => {
    graph.formLeads = [];
    await fireMetaLeadEvent(instantLead({ externalId: "12345" }));
    expect(event().user_data.lead_id).toBeUndefined();
    expect(logged[0].cta).toContain("id:not-found");
  });
});

describe("leads that stay out of the CRM format", () => {
  it("leaves quiz leads as website events", async () => {
    await fireMetaLeadEvent({
      id: "Q1",
      source: "early-retirement-quiz",
      fbclid: "abc",
      email: "q@example.com",
      rawFormData: { event_id: "evt1" },
    });
    expect(event().event_name).toBe("Lead");
    expect(event().action_source).toBe("website");
    expect(event().custom_data).toBeUndefined();
    expect(logged[0].cta).toBe("ok Lead rcvd:1 lead:Q1");
  });

  it("skips a lead with no click and no form", async () => {
    const res = await fireMetaLeadEvent({ id: "X1", source: "referral", rawFormData: {} });
    expect(res.skipped).toContain("not an ad click");
    expect(sent).toHaveLength(0);
  });

  it("gives an advertiser's form no CRM labels and no lookup", async () => {
    mappings.set(FORM, { ownerUserId: "JACE" });
    leads.set("L1", instantLead());
    await fireMetaStageEvent("L1", "approved");
    expect(event().custom_data).toBeUndefined();
    expect(event().user_data.lead_id).toBeUndefined();
    expect(updates).toHaveLength(0);
  });
});

describe("stage events", () => {
  it("reuses a stored id without another lookup", async () => {
    leads.set("L1", instantLead({ rawFormData: { attributionSource: attribution, leadgen_id: META_ID } }));
    await fireMetaStageEvent("L1", "approved");
    expect(sent[0].text).toContain(`"lead_id":${META_ID}`);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(logged[0].cta).toBe("ok Purchase rcvd:1 id:stored lead:L1");
  });

  it("uses the lead's own id when it came straight from Meta", async () => {
    leads.set("L1", instantLead({ externalId: META_ID, source: "Meta - Some form", rawFormData: {} }));
    await fireMetaStageEvent("L1", "underwriting");
    expect(sent[0].text).toContain(`"lead_id":${META_ID}`);
  });

  it("sends one Purchase per lead, at its first closing stage", async () => {
    leads.set("L1", instantLead());
    await fireMetaStageEvent("L1", "underwriting");
    await fireMetaStageEvent("L1", "approved");
    await fireMetaStageEvent("L1", "issued-not-paid");
    expect(sent.map((s) => s.body.data[0].event_name)).toEqual(["Purchase"]);
    expect(event().event_id).toBe("conv_L1");
    expect(logged).toHaveLength(1);
  });

  it("doesn't mistake another lead's Purchase for this one's", async () => {
    leads.set("L1", instantLead());
    leads.set("L10", instantLead({ id: "L10" }));
    await fireMetaStageEvent("L10", "approved");
    await fireMetaStageEvent("L1", "approved");
    expect(sent).toHaveLength(2);
  });

  it("sends the Purchase again after Meta refused the first", async () => {
    leads.set("L1", instantLead());
    graph.capi = () => json({ error: { message: "Invalid parameter", code: 100 } }, 400);
    await fireMetaStageEvent("L1", "underwriting");
    graph.capi = () => json({ events_received: 1 });
    await fireMetaStageEvent("L1", "approved");
    expect(sent).toHaveLength(2);
    expect(logged[1].cta).toContain("ok Purchase");
  });

  it("reports an older move at the time it happened", async () => {
    leads.set("L1", instantLead());
    const movedAt = new Date("2026-11-03T20:04:00Z");
    await fireMetaStageEvent("L1", "approved", null, movedAt);
    expect(event().event_time).toBe(movedAt.getTime() / 1000);
  });

  it("keeps Meta's reason when it refuses an event", async () => {
    leads.set("L1", instantLead());
    graph.capi = () => json({ error: { message: "Invalid parameter", code: 100 } }, 400);
    await fireMetaStageEvent("L1", "issued-not-paid");
    expect(logged[0].step).toBe(400);
    expect(logged[0].cta).toContain("error Purchase");
    expect(logged[0].cta).toContain("Invalid parameter");
  });

  it("keeps Meta's warnings on an accepted event", async () => {
    leads.set("L1", instantLead());
    graph.capi = () => json({ events_received: 0, messages: ["dropped"] });
    await fireMetaStageEvent("L1", "approved");
    expect(logged[0].cta).toContain("ok Purchase rcvd:0");
    expect(logged[0].cta).toContain("dropped");
  });

  it("logs a failed request instead of throwing", async () => {
    leads.set("L1", instantLead());
    graph.capi = () => {
      throw new Error("network down");
    };
    await expect(fireMetaStageEvent("L1", "approved")).resolves.toBeUndefined();
    expect(logged[0].step).toBe(0);
    expect(logged[0].cta).toContain("network down");
  });

  it("sends the premium with Issued PAID, deduped with the partner API", async () => {
    leads.set("L1", instantLead());
    await fireMetaStageEvent("L1", "issued-paid", 240000);
    expect(event().event_name).toBe("Purchase");
    expect(event().event_id).toBe("conv_L1");
    expect(event().custom_data).toMatchObject({ value: 2400, currency: "USD", event_source: "crm" });
  });

  it("does nothing for a stage Meta doesn't track", async () => {
    leads.set("L1", instantLead());
    await fireMetaStageEvent("L1", "dialed");
    expect(sent).toHaveLength(0);
    expect(logged).toHaveLength(0);
  });

  it("logs conversions reported through the partner API too", async () => {
    leads.set("L1", instantLead());
    await fireMetaPurchaseEvent("L1", 120000);
    expect(event().custom_data.event_source).toBe("crm");
    expect(logged[0].cta).toContain("ok Purchase rcvd:1");
  });
});
