import { findPackage } from "@/data/packages";
import { normalizeState } from "./leadImport";
import { stateFromZip, normalizeZip } from "./zipState";

/**
 * Normalize a flat inbound lead payload (from Make.com / Zapier forwarding a
 * Facebook Lead Ad) into our standardized fields, while keeping the ENTIRE
 * original payload as raw data so nothing is ever lost — even brand-new
 * questions from a form we've never seen.
 */

const DEFAULT_PACKAGE = process.env.INBOUND_DEFAULT_PACKAGE_ID || "blue-collar-iul";
const DEFAULT_SOURCE = "Facebook (Make.com)";

// Canonical field -> accepted incoming key aliases (all lowercased).
const ALIASES: Record<string, string[]> = {
  name: ["name", "full_name", "fullname", "full name", "lead_name", "your_name"],
  firstName: ["first_name", "firstname", "first name", "fname"],
  lastName: ["last_name", "lastname", "last name", "lname"],
  email: ["email", "email_address", "email address", "e-mail", "work_email"],
  phone: ["phone", "phone_number", "phonenumber", "phone number", "mobile", "mobile_number", "cell", "telephone"],
  state: ["state", "province", "region", "st", "state_province"],
  zip: ["zip", "zip_code", "zipcode", "postal_code", "postal", "postcode"],
  age: ["age", "your_age"],
  income: ["income", "annual_income", "household_income", "yearly_income"],
  occupation: ["occupation", "job", "job_title", "trade", "profession", "what_do_you_do"],
  intentReason: ["intent", "intent_reason", "reason", "why", "interest", "interested", "why_interested"],
  packageId: ["packageid", "package_id", "package"],
  source: ["source", "form", "form_name"],
  externalId: ["externalid", "external_id", "lead_id", "leadgen_id", "id", "contact_id"],
  // Ad attribution — captured into dedicated columns so the Conversions API can
  // return them for Meta/Google server-side matching (fbclid + UTMs).
  fbclid: ["fbclid", "fbc", "facebook_click_id"],
  utmSource: ["utm_source", "utmsource"],
  utmMedium: ["utm_medium", "utmmedium"],
  utmCampaign: ["utm_campaign", "utmcampaign"],
  campaignName: ["campaign_name", "campaignname", "campaign"],
  adsetId: ["adset_id", "adsetid", "adset", "adset_name", "ad_set"],
  creativeId: ["creative_id", "creativeid", "ad_id", "adid", "creative"],
};

export interface NormalizedInboundLead {
  standardized: {
    name: string;
    email: string;
    phone: string;
    state: string;
    zip?: string;
    age?: number;
    income?: number;
    occupation?: string;
    intentReason?: string;
  };
  attribution: {
    fbclid?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    campaignName?: string;
    adsetId?: string;
    creativeId?: string;
  };
  packageId: string;
  source: string;
  externalId?: string;
  raw: Record<string, string>;
  tags: string[];
}

function toStringValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

export function normalizeInboundLead(body: Record<string, unknown>): NormalizedInboundLead {
  // Lowercase-keyed lookup + a raw (original-key) capture of everything.
  const lookup: Record<string, string> = {};
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(body ?? {})) {
    const str = toStringValue(value);
    raw[key] = str;
    lookup[key.toLowerCase().trim()] = str;
  }

  // GHL nests the webhook's Custom Data under a `customData` object and ad
  // attribution under `attributionSource` (both arrive as JSON strings). The
  // mapped answers (trade/age/income) and the campaign/adset/ad ids only live
  // there, not at top level — so merge their keys into the lookup. Top-level
  // keys win; nested keys only fill gaps.
  const mergeNested = (value: unknown) => {
    let obj: unknown = value;
    if (typeof value === "string") {
      try { obj = JSON.parse(value); } catch { return; }
    }
    if (!obj || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const lk = k.toLowerCase().trim();
      const str = toStringValue(v);
      if (str && (lookup[lk] === undefined || lookup[lk] === "")) lookup[lk] = str;
    }
  };
  mergeNested((body as Record<string, unknown>)?.customData);
  mergeNested((body as Record<string, unknown>)?.attributionSource);

  const pick = (field: string): string => {
    for (const alias of ALIASES[field] ?? []) {
      const v = lookup[alias];
      if (v) return v;
    }
    return "";
  };

  let name = pick("name");
  if (!name) {
    const first = pick("firstName");
    const last = pick("lastName");
    name = [first, last].filter(Boolean).join(" ").trim();
  }
  if (!name) name = pick("email") || "Unknown lead";

  const ageRaw = pick("age");
  const incomeRaw = pick("income");
  const age = ageRaw ? parseInt(ageRaw, 10) : undefined;
  // Take the FIRST number group (lower bound) — income often arrives as a range
  // like "$175,000 – $250,000"; stripping all non-digits would merge both into
  // one nonsense number (175000250000).
  const incomeMatch = incomeRaw.replace(/,/g, "").match(/\d+/);
  const income = incomeMatch ? parseInt(incomeMatch[0], 10) : undefined;

  const requestedPackage = pick("packageId");
  const packageId = requestedPackage && findPackage(requestedPackage)
    ? requestedPackage
    : DEFAULT_PACKAGE;

  return {
    standardized: {
      name,
      email: pick("email"),
      phone: pick("phone"),
      // Normalize to a 2-letter code ("Florida" -> "FL") so the lead matches an
      // order's filterStates. A raw .toUpperCase() ("FLORIDA") silently matches
      // no order and never delivers — the same bug fixed on the Meta path.
      // Prefer an explicit state; otherwise derive it from the ZIP (the funnel
      // collects ZIP, not a state field).
      state: normalizeState(pick("state")).code || stateFromZip(pick("zip")) || "",
      zip: normalizeZip(pick("zip")) || undefined,
      age: Number.isFinite(age) ? age : undefined,
      income: Number.isFinite(income) ? income : undefined,
      occupation: pick("occupation") || undefined,
      intentReason: pick("intentReason") || undefined,
    },
    attribution: {
      fbclid: pick("fbclid") || undefined,
      utmSource: pick("utmSource") || undefined,
      utmMedium: pick("utmMedium") || undefined,
      utmCampaign: pick("utmCampaign") || undefined,
      campaignName: pick("campaignName") || undefined,
      adsetId: pick("adsetId") || undefined,
      creativeId: pick("creativeId") || undefined,
    },
    packageId,
    source: pick("source") || pick("campaignName") || DEFAULT_SOURCE,
    externalId: pick("externalId") || undefined,
    raw,
    // GHL contacts carry tags (top-level, either a comma-joined string or an
    // array). Capture them so a lead-type badge like "American Income Advantage
    // Lead" flows through and can drive routing + display downstream.
    tags: (() => {
      const rawTags = (body as Record<string, unknown>)?.tags;
      const arr = Array.isArray(rawTags)
        ? rawTags.map((t) => String(t))
        : typeof rawTags === "string"
          ? rawTags.split(",")
          : [];
      return [...new Set(arr.map((t) => t.trim()).filter(Boolean))];
    })(),
  };
}
