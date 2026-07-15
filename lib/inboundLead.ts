import { findPackage } from "@/data/packages";

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
  age: ["age", "your_age"],
  income: ["income", "annual_income", "household_income", "yearly_income"],
  occupation: ["occupation", "job", "job_title", "trade", "profession", "what_do_you_do"],
  intentReason: ["intent", "intent_reason", "reason", "why", "interest", "interested", "why_interested"],
  packageId: ["packageid", "package_id", "package"],
  source: ["source", "campaign", "campaign_name", "form", "form_name", "adset", "adset_name", "ad_set"],
  externalId: ["externalid", "external_id", "lead_id", "leadgen_id", "id"],
};

export interface NormalizedInboundLead {
  standardized: {
    name: string;
    email: string;
    phone: string;
    state: string;
    age?: number;
    income?: number;
    occupation?: string;
    intentReason?: string;
  };
  packageId: string;
  source: string;
  externalId?: string;
  raw: Record<string, string>;
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
  const income = incomeRaw ? parseInt(incomeRaw.replace(/[^0-9]/g, ""), 10) : undefined;

  const requestedPackage = pick("packageId");
  const packageId = requestedPackage && findPackage(requestedPackage)
    ? requestedPackage
    : DEFAULT_PACKAGE;

  return {
    standardized: {
      name,
      email: pick("email"),
      phone: pick("phone"),
      state: pick("state").toUpperCase(),
      age: Number.isFinite(age) ? age : undefined,
      income: Number.isFinite(income) ? income : undefined,
      occupation: pick("occupation") || undefined,
      intentReason: pick("intentReason") || undefined,
    },
    packageId,
    source: pick("source") || DEFAULT_SOURCE,
    externalId: pick("externalId") || undefined,
    raw,
  };
}
