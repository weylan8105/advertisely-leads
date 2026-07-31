/**
 * GoHighLevel API v2 helpers.
 * Docs: https://highlevel.stoplight.io/docs/integrations/
 *
 * We hit the v2 endpoints with a Bearer API key. The customer generates this in
 * GHL Settings → Business Profile → API Keys.
 */

const GHL_API = "https://services.leadconnectorhq.com";

export interface GHLContactPayload {
  locationId: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  source?: string;
  tags?: string[];
  customFields?: Array<{ key: string; field_value: string }>;
  state?: string;
}

export interface GHLConfig {
  apiKey: string;
  locationId: string;
}

export async function pushContactToGHL(
  payload: GHLContactPayload,
  config: GHLConfig,
): Promise<{ ok: boolean; status: number; data?: unknown; error?: string }> {
  const res = await fetch(`${GHL_API}/contacts/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (data as any)?.message ?? `GHL ${res.status}`,
    };
  }
  return { ok: true, status: res.status, data };
}

/**
 * Split a "First Last" string into first/last for GHL's separate-name model.
 */
export function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Enhanced Wealth's own GHL (the source CRM where every lead lives). This is a
 * SYSTEM-level credential — distinct from the per-buyer Integration rows — used
 * to tag purchased leads `advertisely-sold` so EW stops dialing them. Reads env
 * vars; returns null (no-op) until configured, so nothing breaks pre-setup.
 */
export function enhancedWealthGHLConfig(): GHLConfig | null {
  const apiKey = process.env.ENHANCED_WEALTH_GHL_API_KEY;
  const locationId = process.env.ENHANCED_WEALTH_GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId };
}

/**
 * Add tag(s) to an existing GHL contact by contact id. Used for the
 * exclusive-sold suppression: tag `advertisely-sold` on purchase so a GHL
 * workflow moves the contact into the Advertisely stage and EW stops dialing.
 */
export async function tagContact(
  contactId: string,
  tags: string[],
  config: GHLConfig,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(
    `${GHL_API}/contacts/${encodeURIComponent(contactId)}/tags`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({ tags }),
      cache: "no-store",
    },
  );
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: (data as any)?.message ?? `GHL ${res.status}`,
    };
  }
  return { ok: true, status: res.status };
}
