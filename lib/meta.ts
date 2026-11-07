import crypto from "crypto";
import { normalizeState, ageFromAnswer } from "./leadImport";
import { stateFromZip, normalizeZip } from "./zipState";

const META_GRAPH_API = "https://graph.facebook.com/v20.0";

export interface MetaLeadgenEvent {
  leadgen_id: string;
  page_id: string;
  form_id: string;
  adgroup_id?: string;
  ad_id?: string;
  created_time: number;
}

export interface MetaLeadgenWebhookPayload {
  object: "page";
  entry: Array<{
    id: string;
    time: number;
    changes: Array<{
      field: "leadgen";
      value: MetaLeadgenEvent;
    }>;
  }>;
}

export interface MetaLeadFieldData {
  name: string;
  values: string[];
}

export interface MetaLeadDetail {
  id: string;
  created_time: string;
  ad_id?: string;
  adset_id?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id: string;
  field_data: MetaLeadFieldData[];
}

// Meta leaves the ad and campaign off a lead unless they're asked for by name.
export const META_LEAD_FIELDS = "id,created_time,ad_id,adset_id,campaign_id,campaign_name,form_id,field_data";

/**
 * Verify the X-Hub-Signature-256 header Meta sends on every webhook delivery.
 * Returns true if the signature is valid; false (or null) means reject.
 */
export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

/**
 * Validate a page access token against the Graph API. Confirms the token works
 * and (optionally) that it belongs to the expected page. Returns the page's
 * real name so the admin UI can confirm they pasted the right token.
 */
export async function validatePageToken(
  pageId: string,
  pageAccessToken: string,
): Promise<{ ok: boolean; name?: string; error?: string }> {
  const url = `${META_GRAPH_API}/${encodeURIComponent(
    pageId,
  )}?fields=name&access_token=${encodeURIComponent(pageAccessToken)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        error: data?.error?.message ?? `Graph API ${res.status}`,
      };
    }
    return { ok: true, name: data?.name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Subscribe a page to this app's `leadgen` webhook field. Until this succeeds,
 * Meta delivers NO leadgen events for the page — connecting a page and mapping
 * forms is not enough on its own. Idempotent: re-subscribing is a no-op.
 */
export async function subscribePageToLeadgen(
  pageId: string,
  pageAccessToken: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = `${META_GRAPH_API}/${encodeURIComponent(pageId)}/subscribed_apps`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        subscribed_fields: "leadgen",
        access_token: pageAccessToken,
      }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) {
      return {
        ok: false,
        error: data?.error?.message ?? `Graph API ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Fetch the actual lead detail (field values etc.) from Meta Graph API
 * using the page access token. Webhook only gives us a leadgen_id.
 */
export async function fetchMetaLeadDetail(
  leadgenId: string,
  pageAccessToken: string,
): Promise<MetaLeadDetail> {
  const url = `${META_GRAPH_API}/${encodeURIComponent(
    leadgenId,
  )}?fields=${META_LEAD_FIELDS}&access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta Graph API ${res.status}: ${text}`);
  }
  return res.json();
}

/**
 * Normalize a Meta instant form field set into a flat record we can store.
 * Meta returns: [{ name: "full_name", values: ["Marcus Halloway"] }, ...]
 * We return:   { full_name: "Marcus Halloway", ... }
 */
export interface MetaFormQuestion {
  key: string;
  label: string;
  type?: string;
}

// Meta lead-form "built-in" question keys that our webhook maps automatically
// (no per-form fieldMapping needed). Everything else is a custom question.
export const META_BUILTIN_KEYS = new Set([
  "full_name", "first_name", "last_name", "email", "phone_number",
  "state", "province", "city", "zip", "post_code", "country", "dob", "gender",
]);

// The DB columns a custom question can be mapped to.
export const MAPPABLE_DB_FIELDS = [
  "name", "email", "phone", "state", "age", "income", "occupation", "intentReason",
] as const;

// Heuristic auto-suggest: match a question's key/label to a DB field.
export function suggestField(key: string, label: string): string | null {
  const t = `${key} ${label}`.toLowerCase();
  if (/\b(income|salary|earn|household)\b/.test(t)) return "income";
  if (/\b(state|province)\b/.test(t)) return "state";
  if (/\b(age)\b/.test(t)) return "age";
  if (/\b(trade|occupation|job|work|profession|career)\b/.test(t)) return "occupation";
  if (/\b(retire|timeline|when|goal|reason|interest)\b/.test(t)) return "intentReason";
  if (/\b(email)\b/.test(t)) return "email";
  if (/\b(phone|mobile|cell)\b/.test(t)) return "phone";
  if (/\b(name)\b/.test(t)) return "name";
  return null;
}

/** A starting field mapping for a form's custom questions. */
export function suggestFieldMapping(questions: MetaFormQuestion[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const q of questions) {
    if (META_BUILTIN_KEYS.has(q.key)) continue;
    const field = suggestField(q.key, q.label);
    if (field) mapping[q.key] = field;
  }
  return mapping;
}

/**
 * Fetch a lead form's questions from the Graph API so an admin can see the
 * exact question keys and map each to a DB column. Requires the page token.
 */
export async function fetchMetaFormQuestions(
  formId: string,
  pageAccessToken: string,
): Promise<{ name?: string; questions: MetaFormQuestion[] }> {
  const url = `${META_GRAPH_API}/${encodeURIComponent(
    formId,
  )}?fields=name,questions&access_token=${encodeURIComponent(pageAccessToken)}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Meta Graph API ${res.status}: ${text}`);
  }
  const data = await res.json();
  return {
    name: data.name,
    questions: (data.questions ?? []).map((q: any) => ({
      key: String(q.key ?? "").toLowerCase().trim(),
      label: q.label ?? q.key ?? "",
      type: q.type,
    })),
  };
}

export function flattenMetaFields(
  fieldData: MetaLeadFieldData[],
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const field of fieldData) {
    flat[field.name.toLowerCase().trim()] = (field.values?.[0] ?? "").trim();
  }
  return flat;
}

/**
 * Apply a stored fieldMapping (Meta question key → our column name) to a
 * flattened lead. Returns standardized fields plus the raw blob.
 */
export function mapLeadFields(
  flat: Record<string, string>,
  fieldMapping: Record<string, string>,
): {
  standardized: {
    name?: string;
    email?: string;
    phone?: string;
    state?: string;
    zip?: string;
    age?: number;
    income?: number;
    occupation?: string;
    intentReason?: string;
  };
  raw: Record<string, string>;
} {
  const standardized: Record<string, string | number> = {};

  // Meta's built-in fields use well-known keys.
  const name = flat.full_name || [flat.first_name, flat.last_name].filter(Boolean).join(" ");
  if (name) standardized.name = name;
  if (flat.email) standardized.email = flat.email;
  if (flat.phone_number) standardized.phone = flat.phone_number;
  // Normalize state to a 2-letter code so it matches order.filterStates.
  // Meta can send full names ("Florida"), mixed case, or codes — all must
  // resolve to "FL", or the lead silently matches no order and never delivers.
  if (flat.state) standardized.state = normalizeState(flat.state).code;
  // Meta's prefilled ZIP question arrives as zip_code (post_code outside the US).
  const zip = normalizeZip(flat.zip_code || flat.post_code || flat.zip || flat.postal_code);
  if (zip) standardized.zip = zip;

  // Apply custom mapping for non-standard form questions.
  for (const [metaKey, ourField] of Object.entries(fieldMapping)) {
    const v = flat[metaKey.toLowerCase().trim()];
    if (!v) continue;
    if (ourField === "age") { const a = ageFromAnswer(v); if (a != null) standardized.age = a; }
    else if (ourField === "income")
      standardized.income = parseInt(v.replace(/[^0-9]/g, ""), 10) || undefined!;
    // Many IUL forms ask state as a custom question — normalize it too.
    else if (ourField === "state") standardized.state = normalizeState(v).code;
    else if (ourField === "zip") { const z = normalizeZip(v); if (z) standardized.zip = z; }
    else standardized[ourField] = v;
  }

  // A form that asks ZIP but not state still gets a state (needed for order
  // matching and licensed-state routing).
  if (!standardized.state && standardized.zip) {
    const st = stateFromZip(String(standardized.zip));
    if (st) standardized.state = st;
  }

  // Fallback: if no field was explicitly mapped to age, derive it from any
  // age-like question (e.g. an "age range" the form's mapping didn't route to
  // age). This is why leads were coming in with a null age.
  if (standardized.age == null) {
    for (const [k, val] of Object.entries(flat)) {
      if (/age/i.test(k)) {
        const a = ageFromAnswer(val);
        if (a != null) { standardized.age = a; break; }
      }
    }
  }

  return {
    standardized: standardized as ReturnType<typeof mapLeadFields>["standardized"],
    raw: flat,
  };
}
