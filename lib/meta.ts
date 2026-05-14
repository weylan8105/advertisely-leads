import crypto from "crypto";

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
  form_id: string;
  field_data: MetaLeadFieldData[];
}

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
 * Fetch the actual lead detail (field values etc.) from Meta Graph API
 * using the page access token. Webhook only gives us a leadgen_id.
 */
export async function fetchMetaLeadDetail(
  leadgenId: string,
  pageAccessToken: string,
): Promise<MetaLeadDetail> {
  const url = `${META_GRAPH_API}/${encodeURIComponent(
    leadgenId,
  )}?access_token=${encodeURIComponent(pageAccessToken)}`;
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
    age?: number;
    income?: number;
    occupation?: string;
    intentReason?: string;
  };
  raw: Record<string, string>;
} {
  const standardized: Record<string, string | number> = {};

  // Meta's built-in fields use well-known keys.
  if (flat.full_name) standardized.name = flat.full_name;
  if (flat.email) standardized.email = flat.email;
  if (flat.phone_number) standardized.phone = flat.phone_number;
  if (flat.state) standardized.state = flat.state.toUpperCase();

  // Apply custom mapping for non-standard form questions.
  for (const [metaKey, ourField] of Object.entries(fieldMapping)) {
    const v = flat[metaKey.toLowerCase().trim()];
    if (!v) continue;
    if (ourField === "age") standardized.age = parseInt(v, 10) || undefined!;
    else if (ourField === "income")
      standardized.income = parseInt(v.replace(/[^0-9]/g, ""), 10) || undefined!;
    else standardized[ourField] = v;
  }

  return {
    standardized: standardized as ReturnType<typeof mapLeadFields>["standardized"],
    raw: flat,
  };
}
