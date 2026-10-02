// Reads cost-per-lead (CPL) from the Facebook Marketing API for the ENHANCED
// WEALTH ad account (never the ABCA / Blue Collar funnel account). CPL = spend
// / lead results over a trailing 7 days.
//
// Config (env — the raw token is never logged or returned):
//   META_ADS_ACCESS_TOKEN         ads_read token (a long-lived System User token)
//   ENHANCED_WEALTH_AD_ACCOUNT_ID ad account id ("act_1234567890" or "1234567890")
//   META_GRAPH_VERSION            optional, defaults to v20.0
//
// Until both are set this is an inert no-op (configured:false) and nothing
// downstream changes.

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const TOKEN = process.env.META_ADS_ACCESS_TOKEN;
const ACCOUNT_RAW = process.env.ENHANCED_WEALTH_AD_ACCOUNT_ID;

// Meta reports leads under several action types depending on how they're tracked
// (Lead Ads vs pixel vs on-site). Sum all of them so the count matches reality.
const LEAD_ACTION_TYPES = new Set([
  "lead",
  "leadgen_grouped",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
]);

export interface CplSnapshot {
  configured: boolean;
  account: string | null;
  windowDays: number;
  spendCents: number;
  leads: number;
  cplCents: number | null; // null = not enough data (no leads) or not configured
  fetchedAt: string;
  error?: string;
}

export function isAdsInsightsConfigured(): boolean {
  return !!TOKEN && !!ACCOUNT_RAW;
}

// Light in-memory cache so pricing/admin reads don't hit the Graph API on every
// request. CPL moves slowly; a 6h TTL is plenty. Per serverless instance.
const TTL_MS = 6 * 60 * 60 * 1000;
let cache: { at: number; snap: CplSnapshot } | null = null;

export async function getEnhancedWealthCpl(
  opts: { force?: boolean } = {},
): Promise<CplSnapshot> {
  const windowDays = 7; // trailing 7 days (owner's choice)
  const now = new Date().toISOString();

  if (!TOKEN || !ACCOUNT_RAW) {
    return { configured: false, account: null, windowDays, spendCents: 0, leads: 0, cplCents: null, fetchedAt: now };
  }
  if (!opts.force && cache && Date.now() - cache.at < TTL_MS) return cache.snap;

  const account = ACCOUNT_RAW.startsWith("act_") ? ACCOUNT_RAW : `act_${ACCOUNT_RAW}`;
  try {
    const url =
      `${GRAPH}/${account}/insights` +
      `?fields=spend,actions&date_preset=last_7d&access_token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      return {
        configured: true, account, windowDays, spendCents: 0, leads: 0, cplCents: null,
        fetchedAt: now, error: json?.error?.message || `HTTP ${res.status}`,
      };
    }
    const row = Array.isArray(json?.data) ? json.data[0] : undefined;
    const spend = parseFloat(row?.spend ?? "0") || 0;
    let leads = 0;
    for (const a of row?.actions ?? []) {
      if (LEAD_ACTION_TYPES.has(a?.action_type)) leads += parseInt(a?.value, 10) || 0;
    }
    const spendCents = Math.round(spend * 100);
    const cplCents = leads > 0 ? Math.round(spendCents / leads) : null;
    const snap: CplSnapshot = { configured: true, account, windowDays, spendCents, leads, cplCents, fetchedAt: now };
    cache = { at: Date.now(), snap };
    return snap;
  } catch (e) {
    return {
      configured: true, account, windowDays, spendCents: 0, leads: 0, cplCents: null,
      fetchedAt: now, error: (e as Error).message,
    };
  }
}
