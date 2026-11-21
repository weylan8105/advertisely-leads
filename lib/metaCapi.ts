import crypto from "crypto";
import { prisma } from "./prisma";
import { instantFormContext, type InstantFormContext } from "./metaLeadId";

/**
 * Meta Conversions API (server-side) — fires events to Meta so the ad account
 * can optimize on real outcomes and match them back to the click.
 *
 * Events:
 *   • "Lead"            — when a quiz lead is created (deduped with the browser
 *                         pixel via the quiz's event_id).
 *   • "Contact"         — when an instant form lead is created. Meta already counts
 *                         the submission; this is the first stage of its CRM funnel.
 *   • "Subscribe"       — our "Qualified Lead" signal: an instant form lead whose
 *                         gross monthly income answer is $3,000 or more AND
 *                         who is 55 or younger (see QUALIFIED_LEAD_EVENT). Sent
 *                         right after "Contact", so Meta gets a high-volume
 *                         quality signal long before there are enough purchases.
 *   • "StartTrial"      — our "Contacted" signal: the first time a lead reaches a
 *                         stage that means we got them on the phone (Contacted,
 *                         Call Back, Presentation Ran or a closing stage). Once
 *                         per lead (see CONTACTED_EVENT / PICKUP_STAGES).
 *   • "Purchase"        — once per lead, the first time it reaches a closing stage
 *                         (Underwriting, Approved, Issued Not Paid or Issued PAID;
 *                         see STAGE_EVENTS). Carries the premium as value when it's
 *                         known, deduped per-lead via conv_<leadId>.
 *
 * Instant form leads go out in Meta's Conversion Leads format (CRM labels plus
 * Meta's lead id when known), which is what lets it optimize those forms on lead
 * quality. Every send's outcome is kept as a FunnelEvent, source "meta-capi".
 *
 * Config (env): META_CAPI_ACCESS_TOKEN (required to fire), META_PIXEL_ID
 * (defaults to the Enhanced Wealth pixel), META_TEST_EVENT_CODE (optional, for
 * Events Manager → Test Events), META_GRAPH_VERSION (optional).
 * With no access token the calls are safe no-ops.
 */

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v20.0";
const PIXEL_ID = process.env.META_PIXEL_ID || "717587103522110";
// The ABCA quiz funnel has its own pixel ("American Blue Collar Advantage Pixel
// Tracker") — the one the ABCA ad sets optimize on and the landing page's browser
// pixel fires to. Its leads must go there (same event_id as the browser = deduped),
// never to the Enhanced Wealth pixel above.
const ABCA_PIXEL_ID = process.env.META_ABCA_PIXEL_ID || "1060042860173387";
const ABCA_SOURCE = "early-retirement-quiz";
// Healthcare Wealth Advantage funnel: runs from the Enhanced Wealth Page + ad
// account, so it fires to the Enhanced Wealth pixel (same id as the landing
// page's browser pixel = deduped). Override with META_HWA_PIXEL_ID if it ever
// gets its own pixel.
const HWA_PIXEL_ID = process.env.META_HWA_PIXEL_ID || "717587103522110";
const HWA_SOURCE = "healthcare-wealth-quiz";
const pixelFor = (lead: { source?: string | null }) =>
  lead.source === ABCA_SOURCE ? ABCA_PIXEL_ID : lead.source === HWA_SOURCE ? HWA_PIXEL_ID : PIXEL_ID;
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN || "";
const TEST_EVENT_CODE = process.env.META_TEST_EVENT_CODE || "";
const PURCHASE_EVENT = process.env.META_PURCHASE_EVENT || "Purchase";
// Standard Meta names only. The Enhanced Wealth pixel is in core setup (Financial
// service), which drops custom event names even though Meta answers 200. Not "Lead":
// that would also count as a pixel Lead for website ad sets optimizing on this pixel.
export const INSTANT_FORM_LEAD_EVENT = "Contact";
// Owner (Nov 16 2026): a qualified lead = answered "What is your gross monthly
// income?" with the second option or better ($3,000 to $5,000, or more) AND
// "What's your age?" with 55 or younger.
// Standard name for the same reason as above (custom names are dropped); nothing
// else sends "Subscribe", so in Meta it means exactly this.
export const QUALIFIED_LEAD_EVENT = "Subscribe";
export const QUALIFIED_MIN_MONTHLY_INCOME = 3000;
export const QUALIFIED_MAX_AGE = 55;
// Owner (Nov 18 2026): on the ABCA main landing page (/) a qualified lead is 20 to
// 55 (ideal is 30-50; 20 and 55 are the outer edges). Leads from before Nov 21
// were asked age only and qualify on age alone; from Nov 21 the page also asks
// a money question (income briefly, then "Which best describes your work right
// now?", see WORK_QUESTION), and those leads need a qualifying answer too. Page B (/qualify) keeps the
// full income + age rule.
export const QUALIFIED_MIN_AGE_AGE_ONLY = 20;
const ABCA_QUIZ_SOURCE = "early-retirement-quiz";

/** An ABCA main-page quiz lead: the funnel that doesn't ask income. */
function isAgeOnlyFunnel(raw: Record<string, unknown>): boolean {
  const source = String(raw["lead_source"] ?? raw["source"] ?? "").trim();
  return source === ABCA_QUIZ_SOURCE && !String(raw["quiz_variant"] ?? "").trim();
}

/** The lead's answer to the gross monthly income question, or null if it wasn't asked. */
export function monthlyIncomeAnswer(rawFormData: unknown): string | null {
  if (!rawFormData || typeof rawFormData !== "object") return null;
  const raw = rawFormData as Record<string, unknown>;
  const key = Object.keys(raw).find((k) => /gross[\s_]*monthly[\s_]*income/i.test(k));
  const v = key ? String(raw[key] ?? "").trim() : "";
  return v || null;
}

/** The lead's answered age (a number), or null if it wasn't asked / isn't a number. */
export function ageAnswer(rawFormData: unknown): number | null {
  if (!rawFormData || typeof rawFormData !== "object") return null;
  const raw = rawFormData as Record<string, unknown>;
  const key = Object.keys(raw).find((k) => /(what'?s|what is)[\s_]*your[\s_]*age\b(?![\s_]*range)/i.test(k) || /^(quiz_)?age$/i.test(k));
  const m = key ? String(raw[key] ?? "").match(/\d{2,3}/) : null;
  return m ? parseInt(m[0], 10) : null;
}

/**
 * The full "Qualified Lead" test: income $3,000+/month AND age 55 or younger
 * (ABCA main-page quiz leads, which aren't asked income: age 20 to 55).
 * true / false when both were answered (false as soon as either fails), null
 * when one is missing and nothing failed (we never guess).
 */
export function isQualifiedLead(rawFormData: unknown): boolean | null {
  const age = ageAnswer(rawFormData);
  const raw = (rawFormData && typeof rawFormData === "object" ? rawFormData : {}) as Record<string, unknown>;
  // The ABCA main page asks about work instead of income (from Nov 21 2026); it stands in for income.
  const income = isIncomeQualified(rawFormData) ?? (isAgeOnlyFunnel(raw) ? isWorkQualified(rawFormData) : null);
  if (isAgeOnlyFunnel(raw)) {
    if (age != null && age < QUALIFIED_MIN_AGE_AGE_ONLY) return false;
    if (income === null) {
      if (age == null) return null;
      return age <= QUALIFIED_MAX_AGE;
    }
  }
  if (income === false || (age != null && age > QUALIFIED_MAX_AGE)) return false;
  if (income === null || age == null) return null;
  return true;
}

// ABCA main page (owner, Nov 21 2026): a subtle money qualifier instead of a plain
// income question. Steady full-time, regular overtime or running a business count;
// "Part-time or seasonal" and "Between jobs right now" don't.
export const WORK_QUESTION = "Which best describes your work right now?";
const WORK_QUALIFIED = ["Full-time with a steady paycheck", "Hourly, with regular overtime", "I run my own business or crew"];

/** Qualified on work? true/false for the work question's answers, null when not asked or unrecognised. */
export function isWorkQualified(rawFormData: unknown): boolean | null {
  if (!rawFormData || typeof rawFormData !== "object") return null;
  const v = String((rawFormData as Record<string, unknown>)[WORK_QUESTION] ?? "").trim();
  if (!v) return null;
  if (WORK_QUALIFIED.includes(v)) return true;
  if (/part-time|seasonal|between jobs/i.test(v)) return false;
  return null;
}

/**
 * Qualified on income? true at $3,000/month or more, false below it, null when
 * the form didn't ask (we never guess). "Under $3,000" is below; "$3,000 to
 * $5,000", "$5,000 to $7,500", "$7,500 to $10,000" and "$10,000+" qualify.
 */
export function isIncomeQualified(rawFormData: unknown): boolean | null {
  const answer = monthlyIncomeAnswer(rawFormData);
  if (!answer) return null;
  if (/\b(under|less than|below)\b/i.test(answer)) return false;
  const m = answer.replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k)?/i);
  if (!m) return null;
  const amount = parseFloat(m[1]) * (m[2] ? 1000 : 1);
  return amount >= QUALIFIED_MIN_MONTHLY_INCOME;
}
const CRM_NAME = "Advertisely";
// A new lead waits on this lookup before it's delivered, so keep it short. Stage
// moves can afford the default, and retry when this one comes up empty.
const INTAKE_LOOKUP_MS = 3000;

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
  source?: string | null;
  name?: string | null;
  state?: string | null;
  zip?: string | null;
};

type EventOpts = {
  eventName: string;
  eventId: string;
  actionSource?: string;
  valueCents?: number | null;
  eventSourceUrl?: string;
  crm?: InstantFormContext | null;
  eventTime?: Date;
};

type SendResult = {
  ok: boolean;
  skipped?: string;
  status?: number;
  error?: string;
  received?: number;
  warning?: string;
};

async function sendMetaEvent(lead: LeadLike, opts: EventOpts): Promise<SendResult> {
  if (!isMetaCapiConfigured) return { ok: false, skipped: "META_CAPI_ACCESS_TOKEN not set" };
  if (!pixelFor(lead)) return { ok: false, skipped: "no pixel set for this funnel (META_HWA_PIXEL_ID)" };

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
  // Extra match keys (Meta's normalization: lowercase, letters only for names,
  // 2-letter state, 5-digit ZIP, ISO country; all SHA-256 like em/ph).
  const parts = (lead.name ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = (v?: string) => (v ? v.toLowerCase().replace(/[^a-z]/g, "") : "");
  const fn = hash(letters(parts[0]));
  if (fn) userData.fn = [fn];
  const ln = hash(letters(parts.length > 1 ? parts[parts.length - 1] : ""));
  if (ln) userData.ln = [ln];
  const st = hash(/^[A-Za-z]{2}$/.test(lead.state ?? "") ? lead.state! : "");
  if (st) userData.st = [st];
  const zp = hash((lead.zip ?? raw["zip"] ?? "").replace(/\D/g, "").slice(0, 5));
  if (zp && (lead.zip ?? raw["zip"] ?? "").replace(/\D/g, "").length >= 5) userData.zp = [zp];
  userData.country = [hash("us")];
  userData.external_id = [hash(lead.id)];
  if (opts.crm?.leadId) userData.lead_id = opts.crm.leadId;

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
  if (opts.crm) {
    customData.event_source = "crm";
    customData.lead_event_source = CRM_NAME;
  }

  const event: Record<string, unknown> = {
    event_name: opts.eventName,
    event_time: Math.floor((opts.eventTime?.getTime() ?? Date.now()) / 1000),
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
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelFor(lead)}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Meta wants lead_id as a number, but 15-17 digits don't survive as a JS one.
        body: JSON.stringify(payload).replace(/"lead_id":"(\d+)"/, '"lead_id":$1'),
      },
    );
    if (res.ok) {
      const reply = await res.json().catch(() => null);
      return {
        ok: true,
        status: res.status,
        received: reply?.events_received,
        warning: reply?.messages?.length ? JSON.stringify(reply.messages).slice(0, 120) : undefined,
      };
    }
    // Keep Meta's reason (e.g. an expired token) — it was silently dropped before.
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, skipped: "request failed", error: (e as Error).message.slice(0, 300) };
  }
}

const sendFailed = (e: unknown): SendResult => ({ ok: false, skipped: "exception", error: String(e).slice(0, 300) });

/**
 * Record a send's outcome (internal FunnelEvent, source "meta-capi" — never shown
 * in the UI or the funnel analytics) so we can see from the DB whether Meta got it.
 */
async function recordCapiResult(lead: LeadLike, eventName: string, result: SendResult, note?: string): Promise<void> {
  if (!result.ok) console.warn(`[meta-capi] ${eventName} for lead ${lead.id} not sent: ${result.skipped ?? ""} ${result.status ?? ""} ${result.error ?? ""}`);
  const raw = (lead.rawFormData && typeof lead.rawFormData === "object"
    ? (lead.rawFormData as Record<string, string>)
    : {}) as Record<string, string>;
  const outcome = result.ok ? `ok ${eventName} rcvd:${result.received ?? "?"}` : `${result.skipped ?? "error"} ${eventName}`;
  await prisma?.funnelEvent
    .create({
      data: {
        sessionId: raw["session_id"] || `lead:${lead.id}`,
        type: "meta_capi",
        source: "meta-capi",
        step: result.status ?? 0,
        cta: [outcome, note, `lead:${lead.id}`, result.error ?? result.warning].filter(Boolean).join(" ").slice(0, 190),
      },
    })
    .catch(() => {});
}

/**
 * Fire the server-side event for a freshly-created lead and record the outcome.
 * Pass occurredAt to report an older lead at its real time.
 */
export async function fireMetaLeadEvent(lead: LeadLike, occurredAt?: Date): Promise<SendResult> {
  const raw = (lead.rawFormData && typeof lead.rawFormData === "object"
    ? (lead.rawFormData as Record<string, string>)
    : {}) as Record<string, string>;
  const clicked = lead.fbclid || raw["fbc"] || raw["fbp"];
  const crm = clicked ? null : await instantFormContext(lead, occurredAt ? undefined : INTAKE_LOOKUP_MS).catch(() => null);
  const eventName = clicked ? raw["event_name"] || "Lead" : crm ? INSTANT_FORM_LEAD_EVENT : "Lead";
  let result: SendResult;
  if (clicked) {
    result = await sendMetaEvent(lead, {
      eventName,
      eventId: raw["event_id"] || `lead_${lead.id}`, // shared with the browser pixel = deduped
      actionSource: "website",
      eventSourceUrl: raw["landing_url"] || undefined,
      eventTime: occurredAt,
    }).catch(sendFailed);
  } else if (crm) {
    result = await sendMetaEvent(lead, {
      eventName,
      eventId: `lead_${lead.id}`,
      actionSource: "system_generated",
      crm,
      eventTime: occurredAt,
    }).catch(sendFailed);
  } else {
    // Only worth sending for ad-sourced leads (need a click id / pixel cookie).
    result = { ok: false, skipped: "not an ad click (no fbclid/fbc/fbp)" };
  }
  await recordCapiResult(lead, eventName, result, crm?.note);
  // A qualified lead also sends the "Qualified Lead" signal: instant form leads in
  // Meta's CRM format, website leads (ABCA page B asks the same questions) as a
  // website event on the funnel's pixel.
  if (isQualifiedLead(lead.rawFormData) === true) {
    if (crm) await sendQualifiedLead(lead, crm, occurredAt);
    else if (clicked && result.ok) {
      const q = await sendMetaEvent(lead, {
        eventName: QUALIFIED_LEAD_EVENT,
        eventId: `qual_${lead.id}`,
        actionSource: "website",
        eventSourceUrl: raw["landing_url"] || undefined,
        eventTime: occurredAt,
      }).catch(sendFailed);
      await recordCapiResult(lead, QUALIFIED_LEAD_EVENT, q);
    }
  }
  return result;
}

async function sendQualifiedLead(lead: LeadLike, crm: InstantFormContext, occurredAt?: Date): Promise<SendResult> {
  const result = await sendMetaEvent(lead, {
    eventName: QUALIFIED_LEAD_EVENT,
    eventId: `qual_${lead.id}`, // one per lead
    actionSource: "system_generated",
    crm,
    eventTime: occurredAt,
  }).catch(sendFailed);
  await recordCapiResult(lead, QUALIFIED_LEAD_EVENT, result, crm.note);
  return result;
}

/**
 * Send only the "Qualified Lead" signal for an existing instant form lead (used
 * to backfill leads that came in before it existed). No-op unless qualified.
 */
export async function fireMetaQualifiedLeadEvent(lead: LeadLike, occurredAt?: Date): Promise<SendResult> {
  if (isQualifiedLead(lead.rawFormData) !== true) return { ok: false, skipped: "not qualified (income $3k+ and age 55 or under)" };
  const raw = (lead.rawFormData && typeof lead.rawFormData === "object" ? lead.rawFormData : {}) as Record<string, string>;
  if (lead.fbclid || raw["fbc"] || raw["fbp"]) return { ok: false, skipped: "website lead, not an instant form" };
  const crm = await instantFormContext(lead).catch(() => null);
  if (!crm) return { ok: false, skipped: "no instant form context" };
  return sendQualifiedLead(lead, crm, occurredAt);
}

/** Fire the server-side "Purchase" event when a lead is marked Issued PAID. */
export async function fireMetaPurchaseEvent(leadId: string, valueCents?: number | null): Promise<void> {
  if (!isMetaCapiConfigured || !prisma) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  const crm = await instantFormContext(lead).catch(() => null);
  const result = await sendMetaEvent(lead, {
    eventName: PURCHASE_EVENT,
    eventId: `conv_${lead.id}`, // stable per lead = deduped if it fires twice
    actionSource: "system_generated",
    valueCents: valueCents ?? lead.soldPremiumCents ?? null,
    crm,
  }).catch(sendFailed);
  await recordCapiResult(lead, PURCHASE_EVENT, result, crm?.note);
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
  tokenDiag?: Record<string, unknown>;
}> {
  if (!isMetaCapiConfigured) return { configured: false };
  // Safe diagnostics on the saved token (no secret revealed) to spot a bad paste:
  // a valid Meta token is long and starts with "EAA"; quotes/spaces = paste error.
  const tokenDiag = {
    length: ACCESS_TOKEN.length,
    startsWithEAA: ACCESS_TOKEN.startsWith("EAA"),
    prefix: ACCESS_TOKEN.slice(0, 4),
    hasQuotes: /["']/.test(ACCESS_TOKEN),
    hasWhitespace: /\s/.test(ACCESS_TOKEN),
  };
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
    return { configured: true, pixelId: PIXEL_ID, status: res.status, body, tokenDiag };
  } catch (e) {
    return { configured: true, pixelId: PIXEL_ID, status: 0, body: (e as Error).message, tokenDiag };
  }
}

// CRM stages that count as a closed deal to Meta. Every one of them is the same
// "Purchase" event (user, 2026-11-08: a deal in underwriting is already a sale to
// us), so the ad account optimizes on one closed-deal signal and the campaign's
// Purchase column counts every deal, not only the ones whose premium has drafted.
// Sent once per lead, the first time it reaches any of these; the premium goes
// with it when it's known (Issued PAID).
export const STAGE_EVENTS: Record<string, { event: string; withValue?: boolean }> = {
  underwriting: { event: PURCHASE_EVENT },
  approved: { event: PURCHASE_EVENT },
  "issued-not-paid": { event: PURCHASE_EVENT },
  "issued-paid": { event: PURCHASE_EVENT, withValue: true },
};

/** Whether Meta already accepted a "Purchase" for this lead (any closing stage). */
// A form lead's event that went out without Meta's lead id: Meta logs it but
// can't credit it to the ad (e.g. the System User couldn't see the form's Page).
export const UNCREDITED_NOTE = /\bid:(no-access|not-found|no-form|timeout|error)\b/;

/**
 * The Purchase this lead already sent, if any: "credited" when Meta could tie it
 * to the ad, "uncredited" when it went out without the lead id (worth sending
 * again once the id can be found), null when none was sent.
 */
async function purchaseAlreadySent(leadId: string): Promise<"credited" | "uncredited" | null> {
  const rows = await prisma!.funnelEvent.findMany({
    where: { source: "meta-capi", cta: { startsWith: `ok ${PURCHASE_EVENT} `, contains: `lead:${leadId}` } },
    select: { cta: true },
  });
  const mine = new RegExp(`lead:${leadId}(\\s|$)`);
  const ours = rows.filter((r) => mine.test(r.cta ?? ""));
  if (ours.length === 0) return null;
  return ours.some((r) => !UNCREDITED_NOTE.test(r.cta ?? "")) ? "credited" : "uncredited";
}

// Owner (Nov 16 2026): pickups are a quality signal. The first time a lead
// reaches any stage that means we got them on the phone, Meta gets one
// "Contacted" event (standard name: custom ones are dropped on this pixel;
// nothing else sends StartTrial).
export const CONTACTED_EVENT = "StartTrial";
export const PICKUP_STAGES = [
  "follow-up", // shown as "Contacted"
  "call-back",
  "presentation-ran",
  "underwriting",
  "approved",
  "issued-not-paid",
  "issued-paid",
] as const;

export function isPickupStage(stage: string): boolean {
  return (PICKUP_STAGES as readonly string[]).includes(stage);
}

async function eventAlreadySent(eventName: string, leadId: string): Promise<boolean> {
  const rows = await prisma!.funnelEvent.findMany({
    where: { source: "meta-capi", cta: { startsWith: `ok ${eventName} `, contains: `lead:${leadId}` } },
    select: { cta: true },
  });
  const mine = new RegExp(`lead:${leadId}(\\s|$)`);
  return rows.some((r) => mine.test(r.cta ?? ""));
}

/** Send the one "Contacted" event a lead gets, the first time it's picked up. */
export async function fireMetaContactedEvent(leadId: string, occurredAt?: Date): Promise<void> {
  if (!isMetaCapiConfigured || !prisma) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  if (await eventAlreadySent(CONTACTED_EVENT, lead.id).catch(() => false)) return;
  const crm = await instantFormContext(lead).catch(() => null);
  const result = await sendMetaEvent(lead, {
    eventName: CONTACTED_EVENT,
    eventId: `contact_${lead.id}`,
    actionSource: "system_generated",
    crm,
    eventTime: occurredAt,
  }).catch(sendFailed);
  await recordCapiResult(lead, CONTACTED_EVENT, result, crm?.note);
}

export function isMetaConversionStage(stage: string): boolean {
  return stage in STAGE_EVENTS;
}

/**
 * Fire the server-side "Purchase" to Meta when a lead advances to a closing
 * stage (underwriting → approved → issued-not-paid → issued-paid). One per lead:
 * the first closing stage it reaches sends it, later moves don't repeat it
 * (Meta only dedupes an event id for 48 hours). Issued PAID carries the premium.
 * No-op for any other stage, or when CAPI isn't configured.
 * Pass occurredAt to report an older move at its real time.
 */
export async function fireMetaStageEvent(
  leadId: string,
  stage: string,
  valueCents?: number | null,
  occurredAt?: Date,
): Promise<void> {
  if (!isMetaCapiConfigured || !prisma) return;
  const cfg = STAGE_EVENTS[stage];
  if (!cfg) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return;
  const prior = await purchaseAlreadySent(lead.id).catch(() => "credited" as const);
  if (prior === "credited") return;
  const crm = await instantFormContext(lead).catch(() => null);
  // Sent before without the lead id: send again only now that Meta can credit it.
  if (prior === "uncredited" && !crm?.leadId) return;
  const result = await sendMetaEvent(lead, {
    eventName: cfg.event,
    // The same event id the partner Conversions API uses, so a sale reported
    // both ways is never double-counted.
    eventId: `conv_${lead.id}`,
    actionSource: "system_generated",
    valueCents: cfg.withValue ? (valueCents ?? lead.soldPremiumCents ?? null) : null,
    crm,
    eventTime: occurredAt,
  }).catch(sendFailed);
  await recordCapiResult(lead, cfg.event, result, crm?.note);
}
