// Outbound push to Ringy (app.ringy.com) — an advertiser's own CRM/dialer.
// An advertiser who runs their own campaign through Advertisely can have their
// exclusive leads forwarded straight into their Ringy account, in addition to
// landing in their Advertisely CRM. Credentials live on a per-user RINGY
// Integration row (config = { sid, authToken }); the forward fires from
// deliverLeadToOwner, the single path every owner-delivered lead takes.

const RINGY_NEW_LEAD_URL = "https://app.ringy.com/api/public/leads/new-lead";

export interface RingyConfig {
  sid: string;
  authToken: string;
}

/** The subset of a Lead we send to Ringy's new-lead API. */
export interface RingyLeadFields {
  name: string;
  phone: string;
  email: string | null;
  state: string | null;
  age: number | null;
  occupation: string | null;
  income: number | null;
  /** The lead's form answers, for monthly_budget and retire_by. */
  rawFormData?: unknown;
}

// Form answers Ringy has fields for, by the names our funnels and Meta forms use.
const MONTHLY_PAYMENT_KEYS = [
  "monthlyBudget",
  "quiz_monthly_contribution",
  "Desired Monthly Contribution",
  "How much could you comfortably put towards building your tax-free retirement each month?",
  "How much could you comfortably put towards building your tax-advantaged retirement each month?",
];
const RETIRE_AGE_KEYS = [
  "retirementTimeline",
  "Desired Retirement Age",
  "What age would you ideally like to retire?",
  "When would you ideally like to retire?",
  "When would you like to retire?",
];

const INCOME_KEYS = [
  "income",
  "householdIncome",
  "What's your current household income?",
  "What's your current annual income?",
  "What is your annual earned income?",
];
const AGE_KEYS = ["age", "What's your age range?"];

// GoHighLevel suffixes some custom-field names with " (old)" when a field was
// replaced, so "When would you ideally like to retire? (old)" must still match.
const norm = (k: string) => k.toLowerCase().replace(/\(old\)\s*$/, "").replace(/[^a-z0-9]/g, "");

/** A form value as plain text; GHL sends multi-selects as a JSON-array string like ["By 55"]. */
function answerText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v == null) return "";
  const s = String(v).trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x)).join(", ");
    } catch {
      /* not JSON — use as-is */
    }
  }
  return s;
}

/** First non-empty answer among `keys` (matched ignoring case, spaces and underscores), made readable. */
export function formAnswer(raw: unknown, keys: string[]): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return "";
  const byKey = new Map<string, unknown>();
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = norm(k);
    if (!answerText(byKey.get(n))) byKey.set(n, v);
  }
  for (const k of keys) {
    const v = byKey.get(norm(k));
    const text = answerText(v);
    if (text.trim()) return text.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

export interface RingyResult {
  ok: boolean;
  status?: number;
  vendorResponseId?: string;
  error?: string;
}

/** True when a config carries both required API keys. */
export function isRingyConfigured(cfg?: Partial<RingyConfig> | null): cfg is RingyConfig {
  return !!cfg && typeof cfg.sid === "string" && !!cfg.sid && typeof cfg.authToken === "string" && !!cfg.authToken;
}

/**
 * POST one lead to Ringy's new-lead endpoint. Ringy expects every value as a
 * string and keys named exactly as below (they're customizable on Ringy's side,
 * but these are their documented defaults). Never throws — returns a result the
 * caller can log without blocking lead delivery.
 */
export async function forwardLeadToRingy(lead: RingyLeadFields, cfg: RingyConfig): Promise<RingyResult> {
  const payload = {
    sid: cfg.sid,
    authToken: cfg.authToken,
    phone_number: lead.phone ?? "",
    full_name: lead.name ?? "",
    email: lead.email ?? "",
    state: lead.state ?? "",
    age: lead.age != null ? String(lead.age) : formAnswer(lead.rawFormData, AGE_KEYS),
    occupation: lead.occupation ?? "",
    income: lead.income != null ? String(lead.income) : formAnswer(lead.rawFormData, INCOME_KEYS),
    monthly_budget: formAnswer(lead.rawFormData, MONTHLY_PAYMENT_KEYS),
    retire_by: formAnswer(lead.rawFormData, RETIRE_AGE_KEYS),
  };

  try {
    const res = await fetch(RINGY_NEW_LEAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      // Map Ringy's documented status codes to a readable reason.
      const reason =
        res.status === 400 ? "bad request (invalid body or missing keys)" :
        res.status === 401 ? "unauthorized (sid/authToken incorrect)" :
        res.status === 508 ? "daily lead limit reached for this API key" :
        `HTTP ${res.status}`;
      const detail = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: `${reason}${detail ? ` — ${detail.slice(0, 160)}` : ""}` };
    }

    const data = (await res.json().catch(() => ({}))) as { vendorResponseId?: string };
    return { ok: true, status: res.status, vendorResponseId: data?.vendorResponseId };
  } catch (err) {
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  }
}
