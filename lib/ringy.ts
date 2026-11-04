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
    age: lead.age != null ? String(lead.age) : "",
    occupation: lead.occupation ?? "",
    income: lead.income != null ? String(lead.income) : "",
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
