import crypto from "crypto";
import { prisma } from "./prisma";

/**
 * Meta Conversions API (server-side) — fires events to Meta so the ad account
 * can optimize on real outcomes and match them back to the click.
 *
 * Two events:
 *   • "Lead"     — when a quiz lead is created (deduped with the browser pixel
 *                  via the quiz's event_id).
 *   • "Purchase" — when a lead is marked Issued PAID (carries the premium as
 *                  value, deduped per-lead via conv_<leadId>).
 *
 * Config (env): META_CAPI_ACCESS_TOKEN (required to fire), META_PIXEL_ID
 * (defaults to the Enhanced Wealth pixel), META_TEST_EVENT_CODE (optional, for
 * Events Manager → Test Events), META_GRAPH_VERSION (optional).
 * With no access token the calls are safe no-ops.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const PIXEL_ID = process.env.META_PIXEL_ID || "717587103522110";
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || "";
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";
const PURCHASE_EVENT = process.env.META_PURCHASE_EVENT || "Purchase";

export const isMetaCapiConfigured = Boolean(ACCESS_TOKEN);

function hash(value?: string | null): string | undefined {
  if (!value) return undefined;
  const norm = value.trim().toLowerCase();
  if (!norm) return undefined;
  return crypto.createHash("sha256").update(norm).digest("hex");
}

function hashPhone(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return undefined;
  if (digits.length === 10) digits = "1" + digits; // Meta wants a country code
  return crypto.createHash("sha256").update(digits).digest("hex");
}

type LeadLike = {
  id: string;
  email?: string | null;
  phone?: string | null;
  fbclid?: string | null;
  consentIp?: string | null;
  soldPremiumCents?: number | null;
  receivedAt?: Date | string | null;
  rawFormData?: unknown;
};

type EventOpts = {
  eventName: string;
  eventId: string;
  actionSource?: string;
  valueCents?: number | null;
  eventSourceUrl?: string;
};

async function sendMetaEvent(lead: LeadLike, opts: EventOpts): Promise<{ ok: boolean; skipped?: string; status?: number }> {
  if (!isMetaCapiConfigured) return { ok: false, skipped: "META_CAPI_ACCESS_TOKEN not set" };

  const raw = (lead.rawFormData && typeof lead.rawFormData === "object"
    ? (lead.rawFormData as Record<string, string>)
    : {}) as Record<string, string>;

  // Rebuild fbc from fbclid if the raw cookie value wasn't captured.
  const receivedMs = lead.receivedAt ? new Date(lead.receivedAt).getTime() : Date.now();
  const fbc = raw["fbc"] || (lead.fbclid ? `fb.1.${receivedMs}.${lead.fbclid}` : undefined);
  const fbp = raw["fbp"] || undefined;

  const userData: Record<string, unknown> = {};
  const em = hash(lead.email);
  if (em) userData.em = [em];
  const ph = hashPhone(lead.phone);
  if (ph) userData.ph = [ph];
  if (fbc) userData.fbc = fbc;
  if (fbp) userData.fbp = fbp;
  if (lead.consentIp) userData.client_ip_address = lead.consentIp;
  const ua = raw["user_agent"] || raw["client_user_agent"];
  if (ua) userData.client_user_agent = ua;

  // Meta needs at least one identifier to match the event.
  if (Object.keys(userData).length === 0) {
    return { ok: false, skipped: "no matchable user_data" };
  }

  const customData: Record<string, unknown> = {};
  if (opts.valueCents != null) {
    customData.value = Math.round(opts.valueCents) / 100;
    customData.currency = "USD";
  }
  if (raw["quiz_lead_tier"]) customData.lead_tier = raw["quiz_lead_tier"];

  const event: Record<string, unknown> = {
    event_name: opts.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: opts.eventId,
    action_source: opts.actionSource || "system_generated",
    user_data: userData,
  };
  if (Object.keys(customData).length) event.custom_data = customData;
  if (opts.eventSourceUrl) event.event_source_url = opts.eventSourceUrl;

  const payload: Record<string, unknown> = { data: [event] };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    );
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, skipped: "request failed" };
  }
}

/** Fire the server-side "Lead" event for a freshly-created quiz lead. */
export async function fireMetaLeadEvent(lead: LeadLike): Promise<void> {
  if (!isMetaCapiConfigured) return;
  const raw = (lead.rawFormData && typeof lead.rawFormData === "object"
    ? (lead.rawFormData as Record<string, string>)
    : {}) as Record<string, string>;
  // Only worth sending for ad-sourced leads (need a click id / pixel cookie).
  if (!lead.fbclid && !raw["fbc"] && !raw["fbp"]) return;
  await sendMetaEvent(lead, {
    eventName: raw["event_name"] || "Lead",
    eventId: raw["event_id"] || `lead_${lead.id}`, // shared with the browser pixel = deduped
    actionSource: "website",
    eventSourceUrl: raw["landing_url"] || undefined,
  }).catch(() => {});
}

/** Fire the server-side "Purchase" event when a lead is marked Issued PAID. */
export async function fireMetaPurchaseEvent(leadId: string, valueCents?: number | null): Promise<void> {
  if (!isMetaCapiConfigured || !prisma) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  await sendMetaEvent(lead, {
    eventName: PURCHASE_EVENT,
    eventId: `conv_${lead.id}`, // stable per lead = deduped if it fires twice
    actionSource: "system_generated",
    valueCents: valueCents ?? lead.soldPremiumCents ?? null,
  }).catch(() => {});
}

/**
 * Fire a benign server test event to confirm the token + pixel are wired,
 * returning Meta's raw response. Lets us verify configuration end-to-end
 * without access to Events Manager. Never returns the access token.
 */
export async function sendMetaTestEvent(): Promise<{
  configured: boolean;
  pixelId?: string;
  status?: number;
  body?: unknown;
}> {
  if (!isMetaCapiConfigured) return { configured: false };
  const em = crypto.createHash("sha256").update("test@advertisely.io").digest("hex");
  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: "AdvertiselyServerTest", // custom, non-polluting event name
        event_time: Math.floor(Date.now() / 1000),
        event_id: `test_${Date.now()}`,
        action_source: "system_generated",
        user_data: { em: [em] },
      },
    ],
  };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;
  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    );
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    return { configured: true, pixelId: PIXEL_ID, status: res.status, body };
  } catch (e) {
    return { configured: true, pixelId: PIXEL_ID, status: 0, body: (e as Error).message };
  }
}

// CRM stages that count as a "converting" signal worth sending to Meta, and the
// event each maps to. Facebook uses these to find more people like the ones who
// progress this far. Only the actual paid sale carries the premium as value.
const STAGE_EVENTS: Record<string, { event: string; withValue?: boolean }> = {
  underwriting: { event: "SubmitApplication" },
  approved: { event: "Approved" },
  "issued-not-paid": { event: "IssuedNotPaid" },
  "issued-paid": { event: PURCHASE_EVENT, withValue: true },
};

export function isMetaConversionStage(stage: string): boolean {
  return stage in STAGE_EVENTS;
}

/**
 * Fire a server-side conversion signal to Meta when a lead advances to a
 * high-intent stage (underwriting → approved → issued-not-paid → issued-paid).
 * Each stage is its own event, deduped per lead+stage; the paid sale carries the
 * premium as value. No-op for any other stage, or when CAPI isn't configured.
 */
export async function fireMetaStageEvent(
  leadId: string,
  stage: string,
  valueCents?: number | null,
): Promise<void> {
  if (!isMetaCapiConfigured || !prisma) return;
  const cfg = STAGE_EVENTS[stage];
  if (!cfg) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  // Issued-paid shares the "Purchase" event id used by the partner Conversions
  // API so the sale is never double-counted; other stages dedupe per stage.
  const eventId = stage === "issued-paid" ? `conv_${lead.id}` : `${stage}_${lead.id}`;
  await sendMetaEvent(lead, {
    eventName: cfg.event,
    eventId,
    actionSource: "system_generated",
    valueCents: cfg.withValue ? (valueCents ?? lead.soldPremiumCents ?? null) : null,
  }).catch(() => {});
}
