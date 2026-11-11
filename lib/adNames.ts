import { prisma } from "./prisma";

// Names for an ad id, from the Ads API. The quiz funnel only passes Meta's ad id
// ({{ad.id}} as utm_content), so the ad, ad set and campaign names admins see on
// a lead come from here. Best effort: a lead is never held up by this lookup.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const META_ID = /^\d{15,19}$/;
const LOOKUP_BUDGET_MS = 3000;

export interface AdNames {
  adName?: string;
  adsetName?: string;
  campaignName?: string;
}

const cache = new Map<string, AdNames>();

function token(): string | undefined {
  return process.env.META_ADS_ACCESS_TOKEN || process.env.META_ADS_MANAGE_TOKEN;
}

/** The ad's name, its ad set's and its campaign's, or null when Meta can't say. */
export async function fetchAdNames(adId: string, budgetMs = LOOKUP_BUDGET_MS): Promise<AdNames | null> {
  // Lead exports write ad ids as "ag:<id>".
  const id = adId.trim().replace(/^ag:/, "");
  const tok = token();
  if (!tok || !META_ID.test(id)) return null;
  const hit = cache.get(id);
  if (hit) return hit;
  const qs = new URLSearchParams({ fields: "name,adset{name},campaign{name}", access_token: tok });
  const res = await fetch(`${GRAPH}/${id}?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(budgetMs) });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Graph API ${res.status}`);
  const names: AdNames = {
    adName: data.name || undefined,
    adsetName: data.adset?.name || undefined,
    campaignName: data.campaign?.name || undefined,
  };
  cache.set(id, names);
  return names;
}

type LeadForNames = {
  id: string;
  creativeId?: string | null;
  adName?: string | null;
  adsetName?: string | null;
  campaignName?: string | null;
};

/** What the lookup would add to this lead: only its blank name columns. */
export function adNamesToFill(lead: LeadForNames, names: AdNames): Partial<AdNames> {
  const fill: Partial<AdNames> = {};
  if (!lead.adName && names.adName) fill.adName = names.adName;
  if (!lead.adsetName && names.adsetName) fill.adsetName = names.adsetName;
  if (!lead.campaignName && names.campaignName) fill.campaignName = names.campaignName;
  return fill;
}

/**
 * Fill a lead's blank ad name columns from its ad id. Skips leads that already
 * have an ad name or no ad id. Errors are swallowed: the names can be filled
 * later and the lead must go on to delivery regardless.
 */
export async function fillAdNames(lead: LeadForNames): Promise<Partial<AdNames>> {
  if (!lead.creativeId || lead.adName) return {};
  try {
    const names = await fetchAdNames(lead.creativeId);
    if (!names) return {};
    const fill = adNamesToFill(lead, names);
    if (Object.keys(fill).length > 0) await prisma?.lead.update({ where: { id: lead.id }, data: fill });
    return fill;
  } catch (err) {
    console.warn(`[ad-names] lead ${lead.id}: ${(err as Error).message}`);
    return {};
  }
}
