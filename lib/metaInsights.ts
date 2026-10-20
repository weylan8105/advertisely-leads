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
// The ABCA / Blue Collar funnel's OWN ad account (the one whose ads point at
// americanbluecollaradvantage.com). Separate from the Enhanced Wealth account
// above. Needed to compute a TRUE ad-conversion rate (leads ÷ real Facebook
// clicks), since Facebook reports more clicks than our page-view beacon ever
// sees. Inert until set.
const ABCA_ACCOUNT_RAW = process.env.ABCA_AD_ACCOUNT_ID;

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

export function isAbcaAdsConfigured(): boolean {
  return !!TOKEN && !!ABCA_ACCOUNT_RAW;
}

export interface AbcaAdSnapshot {
  configured: boolean;
  linkClicks: number;
  landingPageViews: number;
  fetchedAt: string;
  error?: string;
}

// Short cache (keyed by date range) so repeated admin loads don't hammer Graph.
const AD_TTL_MS = 60 * 60 * 1000; // 1h
const abcaCache = new Map<string, { at: number; snap: AbcaAdSnapshot }>();

/**
 * Facebook link clicks + landing-page views for the ABCA funnel ad account over
 * an explicit [sinceYmd, untilYmd] window. These are the real denominators for a
 * true ad-conversion rate (leads ÷ clicks / leads ÷ landing-page views), which
 * reads lower than leads ÷ tracked page views because many clicks never fire our
 * on-page beacon. Inert (configured:false) until ABCA_AD_ACCOUNT_ID is set.
 */
export async function getAbcaAdInsights(sinceYmd: string, untilYmd: string): Promise<AbcaAdSnapshot> {
  const now = new Date().toISOString();
  if (!TOKEN || !ABCA_ACCOUNT_RAW) {
    return { configured: false, linkClicks: 0, landingPageViews: 0, fetchedAt: now };
  }
  const key = `${sinceYmd}:${untilYmd}`;
  const cached = abcaCache.get(key);
  if (cached && Date.now() - cached.at < AD_TTL_MS) return cached.snap;

  const account = ABCA_ACCOUNT_RAW.startsWith("act_") ? ABCA_ACCOUNT_RAW : `act_${ABCA_ACCOUNT_RAW}`;
  try {
    const timeRange = encodeURIComponent(JSON.stringify({ since: sinceYmd, until: untilYmd }));
    const url =
      `${GRAPH}/${account}/insights` +
      `?fields=inline_link_clicks,actions&time_range=${timeRange}&access_token=${encodeURIComponent(TOKEN)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      return {
        configured: true, linkClicks: 0, landingPageViews: 0,
        fetchedAt: now, error: json?.error?.message || `HTTP ${res.status}`,
      };
    }
    const row = Array.isArray(json?.data) ? json.data[0] : undefined;
    const linkClicks = parseInt(row?.inline_link_clicks ?? "0", 10) || 0;
    let landingPageViews = 0;
    for (const a of row?.actions ?? []) {
      if (a?.action_type === "landing_page_view") landingPageViews += parseInt(a?.value, 10) || 0;
    }
    const snap: AbcaAdSnapshot = { configured: true, linkClicks, landingPageViews, fetchedAt: now };
    abcaCache.set(key, { at: Date.now(), snap });
    return snap;
  } catch (e) {
    return { configured: true, linkClicks: 0, landingPageViews: 0, fetchedAt: now, error: (e as Error).message };
  }
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
