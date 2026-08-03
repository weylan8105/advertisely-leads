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
 * Add tag(s) to an existing GHL contact by id. Used to stamp a converted lead
 * `advertisely-sold` so Enhanced Wealth pulls it out of the dialing view and it
 * leaves the sellable pool.
 */
export async function addTagToGHLContact(
  contactId: string,
  tags: string[],
  config: GHLConfig,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const res = await fetch(`${GHL_API}/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    },
    body: JSON.stringify({ tags }),
    cache: "no-store",
  });
  const data = await res.json().catch(() => undefined);
  if (!res.ok) {
    return { ok: false, status: res.status, error: (data as any)?.message ?? `GHL ${res.status}` };
  }
  return { ok: true, status: res.status };
}

/** Platform-level GHL config for outbound sold-tagging (Enhanced Wealth master). */
export function platformGHLConfig(): GHLConfig | null {
  const apiKey = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!apiKey || !locationId) return null;
  return { apiKey, locationId };
}

/**
 * Split a "First Last" string into first/last for GHL's separate-name model.
 */
export function splitName(full: string): { firstName: string; lastName?: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
