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

// Healthcare Wealth Advantage campaigns run inside the Enhanced Wealth ad account
// but are a different funnel (nurse leads, not Blue Collar). Any campaign whose
// name contains "HWA" is left out of CPL / spend so it can't move the fresh-lead
// price floor or the house-lead invoice.
const EXCLUDE_HWA = `&filtering=${encodeURIComponent(
  JSON.stringify([{ field: "campaign.name", operator: "NOT_CONTAIN", value: "HWA" }]),
)}`;

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
      `?fields=spend,actions&date_preset=last_7d${EXCLUDE_HWA}&access_token=${encodeURIComponent(TOKEN)}`;
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

export interface AbcaAdCostRow {
  adId: string;
  adName: string;
  adsetName: string;
  status: string | null;
  spendCents: number;
  landingPageViews: number;
  /** Leads as Meta reports them (its attribution: includes 1-day view-through and late-attributed conversions). */
  metaLeads: number;
}

const adCostCache = new Map<string, { at: number; rows: AbcaAdCostRow[] }>();

/**
 * Spend, landing-page views and Meta-reported leads per ad for the ABCA ad
 * account over [sinceYmd, untilYmd] (account time zone). Paired with the leads
 * that actually reached us (quiz leads carry the ad id in utm_content) to show
 * the real cost per lead. 15-minute cache; inert until ABCA_AD_ACCOUNT_ID is set.
 */
export async function getAbcaAdCosts(
  sinceYmd: string,
  untilYmd: string,
): Promise<{ configured: boolean; rows: AbcaAdCostRow[]; error?: string }> {
  if (!TOKEN || !ABCA_ACCOUNT_RAW) return { configured: false, rows: [] };
  const key = `${sinceYmd}:${untilYmd}`;
  const cached = adCostCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return { configured: true, rows: cached.rows };

  const account = ABCA_ACCOUNT_RAW.startsWith("act_") ? ABCA_ACCOUNT_RAW : `act_${ABCA_ACCOUNT_RAW}`;
  try {
    const timeRange = encodeURIComponent(JSON.stringify({ since: sinceYmd, until: untilYmd }));
    const [insRes, adsRes] = await Promise.all([
      fetch(
        `${GRAPH}/${account}/insights?level=ad&fields=ad_id,ad_name,adset_name,spend,actions` +
          `&time_range=${timeRange}&limit=500&access_token=${encodeURIComponent(TOKEN)}`,
        { cache: "no-store" },
      ),
      fetch(`${GRAPH}/${account}/ads?fields=id,effective_status&limit=500&access_token=${encodeURIComponent(TOKEN)}`, {
        cache: "no-store",
      }),
    ]);
    const ins: any = await insRes.json().catch(() => ({}));
    if (!insRes.ok || ins?.error) {
      return { configured: true, rows: [], error: ins?.error?.message || `HTTP ${insRes.status}` };
    }
    const ads: any = await adsRes.json().catch(() => ({}));
    const statusById = new Map<string, string>(
      (Array.isArray(ads?.data) ? ads.data : []).map((a: any) => [String(a.id), String(a.effective_status)]),
    );
    const rows: AbcaAdCostRow[] = (Array.isArray(ins?.data) ? ins.data : []).map((r: any) => {
      const acts: any[] = r?.actions ?? [];
      const val = (t: string) => {
        const a = acts.find((x) => x?.action_type === t);
        return a ? parseInt(a.value, 10) || 0 : null;
      };
      // "lead" is Meta's rolled-up total; fall back to the pixel-lead type. Never sum both (double count).
      const metaLeads = val("lead") ?? val("offsite_conversion.fb_pixel_lead") ?? 0;
      return {
        adId: String(r.ad_id),
        adName: String(r.ad_name ?? r.ad_id),
        adsetName: String(r.adset_name ?? ""),
        status: statusById.get(String(r.ad_id)) ?? null,
        spendCents: Math.round((parseFloat(r.spend ?? "0") || 0) * 100),
        landingPageViews: val("landing_page_view") ?? 0,
        metaLeads,
      };
    });
    adCostCache.set(key, { at: Date.now(), rows });
    return { configured: true, rows };
  } catch (e) {
    return { configured: true, rows: [], error: (e as Error).message };
  }
}

// ─── Blended ad spend across BOTH ad accounts (house-lead invoice) ──────────
export interface BlendedSpendSnapshot {
  configured: boolean;
  spendCents: number; // sum across configured accounts
  accounts: { label: string; spendCents: number; error?: string }[];
  windowDays: number;
  fetchedAt: string;
}

async function fetchAccountSpendCents(accountRaw: string): Promise<{ spendCents: number; error?: string }> {
  const account = accountRaw.startsWith("act_") ? accountRaw : `act_${accountRaw}`;
  try {
    const url = `${GRAPH}/${account}/insights?fields=spend&date_preset=last_7d${EXCLUDE_HWA}&access_token=${encodeURIComponent(TOKEN!)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) return { spendCents: 0, error: json?.error?.message || `HTTP ${res.status}` };
    const row = Array.isArray(json?.data) ? json.data[0] : undefined;
    return { spendCents: Math.round((parseFloat(row?.spend ?? "0") || 0) * 100) };
  } catch (e) {
    return { spendCents: 0, error: (e as Error).message };
  }
}

/**
 * Total last-7d ad spend across BOTH ad accounts (Enhanced Wealth + ABCA) — the
 * numerator for the blended house-lead CPL. Inert (configured:false) until
 * META_ADS_ACCESS_TOKEN plus at least one account id is set.
 */
export async function getBlendedAdSpend7d(): Promise<BlendedSpendSnapshot> {
  const fetchedAt = new Date().toISOString();
  const windowDays = 7;
  if (!TOKEN || (!ACCOUNT_RAW && !ABCA_ACCOUNT_RAW)) {
    return { configured: false, spendCents: 0, accounts: [], windowDays, fetchedAt };
  }
  const accounts: BlendedSpendSnapshot["accounts"] = [];
  let total = 0;
  if (ACCOUNT_RAW) {
    const r = await fetchAccountSpendCents(ACCOUNT_RAW);
    accounts.push({ label: "Enhanced Wealth", spendCents: r.spendCents, error: r.error });
    total += r.spendCents;
  }
  if (ABCA_ACCOUNT_RAW) {
    const r = await fetchAccountSpendCents(ABCA_ACCOUNT_RAW);
    accounts.push({ label: "ABCA", spendCents: r.spendCents, error: r.error });
    total += r.spendCents;
  }
  return { configured: true, spendCents: total, accounts, windowDays, fetchedAt };
}

// Spend for one account over an explicit [sinceYmd, untilYmd] window.
async function fetchAccountSpendRange(accountRaw: string, sinceYmd: string, untilYmd: string): Promise<{ spendCents: number; error?: string }> {
  const account = accountRaw.startsWith("act_") ? accountRaw : `act_${accountRaw}`;
  try {
    const timeRange = encodeURIComponent(JSON.stringify({ since: sinceYmd, until: untilYmd }));
    const url = `${GRAPH}/${account}/insights?fields=spend&time_range=${timeRange}${EXCLUDE_HWA}&access_token=${encodeURIComponent(TOKEN!)}`;
    const res = await fetch(url, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) return { spendCents: 0, error: json?.error?.message || `HTTP ${res.status}` };
    const row = Array.isArray(json?.data) ? json.data[0] : undefined;
    return { spendCents: Math.round((parseFloat(row?.spend ?? "0") || 0) * 100) };
  } catch (e) {
    return { spendCents: 0, error: (e as Error).message };
  }
}

/** Total ad spend across BOTH accounts over an explicit date window (YYYY-MM-DD). */
export async function getBlendedAdSpendRange(sinceYmd: string, untilYmd: string): Promise<BlendedSpendSnapshot> {
  const fetchedAt = new Date().toISOString();
  const windowDays = Math.max(1, Math.round((Date.parse(untilYmd) - Date.parse(sinceYmd)) / 86_400_000));
  if (!TOKEN || (!ACCOUNT_RAW && !ABCA_ACCOUNT_RAW)) {
    return { configured: false, spendCents: 0, accounts: [], windowDays, fetchedAt };
  }
  const accounts: BlendedSpendSnapshot["accounts"] = [];
  let total = 0;
  if (ACCOUNT_RAW) { const r = await fetchAccountSpendRange(ACCOUNT_RAW, sinceYmd, untilYmd); accounts.push({ label: "Enhanced Wealth", spendCents: r.spendCents, error: r.error }); total += r.spendCents; }
  if (ABCA_ACCOUNT_RAW) { const r = await fetchAccountSpendRange(ABCA_ACCOUNT_RAW, sinceYmd, untilYmd); accounts.push({ label: "ABCA", spendCents: r.spendCents, error: r.error }); total += r.spendCents; }
  return { configured: true, spendCents: total, accounts, windowDays, fetchedAt };
}

// ─── Creative scorecard: spend + names per ad across BOTH ad accounts ────────
// Unlike the CPL / blended-spend helpers above, HWA campaigns are INCLUDED here
// (the scorecard ranks every ad). Account ids fall back to the known accounts so
// the scorecard works with just the token set.
const SCORECARD_ACCOUNTS: { label: "ABCA" | "Enhanced Wealth"; raw: string }[] = [
  { label: "ABCA", raw: ABCA_ACCOUNT_RAW || "2126340781245705" },
  { label: "Enhanced Wealth", raw: ACCOUNT_RAW || "2254810101392917" },
];

export interface ScorecardAd {
  adId: string;
  adName: string;
  adsetId: string;
  adsetName: string;
  campaignName: string;
  account: "ABCA" | "Enhanced Wealth";
  status: string | null;
  spendCents: number;
}

export interface ScorecardSpend {
  configured: boolean;
  ads: ScorecardAd[];
  /** Ad set id → name, for older leads that only recorded their ad set. */
  adsets: Record<string, string>;
  errors: string[];
}

// Every status except DELETED, so paused/archived ads still get a name.
const AD_STATUSES = [
  "ACTIVE", "PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES", "PENDING_REVIEW", "DISAPPROVED",
  "PREAPPROVED", "PENDING_BILLING_INFO", "CAMPAIGN_PAUSED", "ADSET_PAUSED",
];

const scorecardCache = new Map<string, { at: number; snap: ScorecardSpend }>();

// Follow Graph API paging (capped) and return every row.
async function fetchAllPages(url: string, maxPages = 8): Promise<{ rows: any[]; error?: string }> {
  const rows: any[] = [];
  let next: string | undefined = url;
  for (let i = 0; next && i < maxPages; i++) {
    const res: Response = await fetch(next, { cache: "no-store" });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) return { rows, error: json?.error?.message || `HTTP ${res.status}` };
    if (Array.isArray(json?.data)) rows.push(...json.data);
    next = json?.paging?.next;
  }
  return { rows };
}

/**
 * Spend per ad (plus names/status for every ad, spending or not) for the ABCA
 * and Enhanced Wealth ad accounts. `sinceYmd` null = all time. 15-minute cache.
 */
export async function getScorecardSpend(sinceYmd: string | null, untilYmd: string): Promise<ScorecardSpend> {
  if (!TOKEN) return { configured: false, ads: [], adsets: {}, errors: [] };
  const key = `${sinceYmd ?? "all"}:${untilYmd}`;
  const cached = scorecardCache.get(key);
  if (cached && Date.now() - cached.at < 15 * 60 * 1000) return cached.snap;

  const range = sinceYmd
    ? `time_range=${encodeURIComponent(JSON.stringify({ since: sinceYmd, until: untilYmd }))}`
    : "date_preset=maximum";
  const tok = `access_token=${encodeURIComponent(TOKEN)}`;
  const ads: ScorecardAd[] = [];
  const adsets: Record<string, string> = {};
  const errors: string[] = [];

  await Promise.all(
    SCORECARD_ACCOUNTS.map(async ({ label, raw }) => {
      const account = raw.startsWith("act_") ? raw : `act_${raw}`;
      const [ins, list] = await Promise.all([
        fetchAllPages(`${GRAPH}/${account}/insights?level=ad&fields=ad_id,ad_name,adset_id,adset_name,campaign_name,spend&${range}&limit=500&${tok}`),
        fetchAllPages(
          `${GRAPH}/${account}/ads?fields=id,name,effective_status,adset{id,name},campaign{name}` +
            `&effective_status=${encodeURIComponent(JSON.stringify(AD_STATUSES))}&limit=500&${tok}`,
        ),
      ]);
      if (ins.error) errors.push(`${label}: ${ins.error}`);
      if (list.error) errors.push(`${label} ad list: ${list.error}`);
      const insById = new Map<string, any>(ins.rows.map((r) => [String(r.ad_id), r]));
      const cents = (r: any) => Math.round((parseFloat(r?.spend ?? "0") || 0) * 100);
      for (const a of list.rows) {
        const adsetId = String(a.adset?.id ?? "");
        if (adsetId) adsets[adsetId] = String(a.adset?.name ?? adsetId);
        ads.push({
          adId: String(a.id),
          adName: String(a.name ?? a.id),
          adsetId,
          adsetName: String(a.adset?.name ?? ""),
          campaignName: String(a.campaign?.name ?? ""),
          account: label,
          status: a.effective_status ? String(a.effective_status) : null,
          spendCents: cents(insById.get(String(a.id))),
        });
        insById.delete(String(a.id));
      }
      // Spend on ads the list didn't return (deleted, or past the page cap).
      for (const [adId, r] of insById) {
        const adsetId = String(r.adset_id ?? "");
        if (adsetId && !adsets[adsetId]) adsets[adsetId] = String(r.adset_name ?? adsetId);
        ads.push({
          adId,
          adName: String(r.ad_name ?? adId),
          adsetId,
          adsetName: String(r.adset_name ?? ""),
          campaignName: String(r.campaign_name ?? ""),
          account: label,
          status: null,
          spendCents: cents(r),
        });
      }
    }),
  );

  const snap: ScorecardSpend = { configured: true, ads, adsets, errors };
  if (!errors.length) scorecardCache.set(key, { at: Date.now(), snap });
  return snap;
}

// --- Ad Performance dashboard ------------------------------------------------

export type PerfFunnel = "ew" | "abca";

// Each ad account reports days in its own timezone.
const PERF_ACCOUNTS: { funnel: PerfFunnel; raw: string; tz: string; pixel: string }[] = [
  { funnel: "ew", raw: ACCOUNT_RAW || "2254810101392917", tz: "America/Los_Angeles", pixel: "717587103522110" },
  { funnel: "abca", raw: ABCA_ACCOUNT_RAW || "2126340781245705", tz: "America/Chicago", pixel: "1060042860173387" },
];

// Campaigns run for clients: their spend and leads are theirs, not ours.
export const isClientCampaign = (name?: string | null) => /^Advertisely Advertiser/.test(name ?? "");

export interface CampaignPerf {
  campaignId: string;
  name: string;
  funnel: PerfFunnel;
  status: string | null;
  dailyBudgetCents: number | null;
  spendCents: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  metaLeads: number;
}

export interface MetaPerformance {
  configured: boolean;
  campaigns: CampaignPerf[];
  // Spend per day and funnel, keyed `${ymd}:${funnel}`.
  dailySpendCents: Record<string, number>;
  // Events the pixels show for the window. Null when they can't be read.
  pixelEvents: Record<string, number> | null;
  // Funnels whose spend Meta wouldn't return, so their costs can't be worked out.
  missing: PerfFunnel[];
  errors: string[];
}

const perfCache = new Map<string, { at: number; snap: MetaPerformance }>();
const PERF_TTL_MS = 55 * 1000;
// Only reads here. Kept apart from TOKEN so this doesn't switch on the CPL price
// floor or the house-lead invoice amounts, which turn on when TOKEN is set.
const PERF_TOKEN = TOKEN || process.env.META_ADS_MANAGE_TOKEN;

const toCents = (v: unknown) => Math.round((parseFloat(String(v ?? "0")) || 0) * 100);
const toInt = (v: unknown) => parseInt(String(v ?? "0"), 10) || 0;
const timeRange = (r: { since: string; until: string }) => `time_range=${encodeURIComponent(JSON.stringify(r))}`;

/**
 * Spend and delivery per campaign for both ad accounts, plus 14 days of daily
 * spend and what each pixel shows. `rangeFor` turns a timezone into that
 * account's dates. Client campaigns are left out. One-minute cache.
 */
export async function getMetaPerformance(
  key: string,
  rangeFor: (tz: string) => { since: string; until: string },
  trendFor: (tz: string) => { since: string; until: string },
  pixelWindow: { since: Date; until: Date } | null,
): Promise<MetaPerformance> {
  if (!PERF_TOKEN) {
    return { configured: false, campaigns: [], dailySpendCents: {}, pixelEvents: null, missing: ["ew", "abca"], errors: [] };
  }
  const cached = perfCache.get(key);
  if (cached && Date.now() - cached.at < PERF_TTL_MS) return cached.snap;

  const tok = `access_token=${encodeURIComponent(PERF_TOKEN)}`;
  const campaigns: CampaignPerf[] = [];
  const dailySpendCents: Record<string, number> = {};
  const errors: string[] = [];
  const missing: PerfFunnel[] = [];
  let pixelEvents: Record<string, number> | null = pixelWindow ? {} : null;

  await Promise.all(
    PERF_ACCOUNTS.map(async ({ funnel, raw, tz, pixel }) => {
      const account = raw.startsWith("act_") ? raw : `act_${raw}`;
      const [ins, daily, list, adsets, stats] = await Promise.all([
        fetchAllPages(
          `${GRAPH}/${account}/insights?level=campaign&fields=campaign_id,campaign_name,spend,impressions,clicks,inline_link_clicks,actions&${timeRange(rangeFor(tz))}&limit=200&${tok}`,
        ),
        fetchAllPages(
          `${GRAPH}/${account}/insights?level=campaign&fields=campaign_name,spend&time_increment=1&${timeRange(trendFor(tz))}&limit=500&${tok}`,
        ),
        fetchAllPages(`${GRAPH}/${account}/campaigns?fields=id,name,effective_status,daily_budget&limit=200&${tok}`),
        fetchAllPages(
          `${GRAPH}/${account}/adsets?fields=campaign_id,daily_budget&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=500&${tok}`,
        ),
        pixelWindow
          ? fetchAllPages(
              `${GRAPH}/${pixel}/stats?aggregation=event&start_time=${Math.floor(pixelWindow.since.getTime() / 1000)}&end_time=${Math.floor(pixelWindow.until.getTime() / 1000)}&limit=500&${tok}`,
            )
          : Promise.resolve({ rows: [] as any[], error: undefined as string | undefined }),
      ]);
      for (const [name, r] of [["spend", ins], ["daily spend", daily], ["campaigns", list]] as const) {
        if (r.error) errors.push(`${funnel} ${name}: ${r.error}`);
      }
      if (ins.error || list.error) missing.push(funnel);

      const insById = new Map<string, any>(ins.rows.map((r) => [String(r.campaign_id), r]));
      const adsetBudget = new Map<string, number>();
      for (const a of adsets.rows) {
        const id = String(a.campaign_id);
        adsetBudget.set(id, (adsetBudget.get(id) ?? 0) + toInt(a.daily_budget));
      }
      for (const c of list.rows) {
        if (isClientCampaign(c.name)) continue;
        const id = String(c.id);
        const r = insById.get(id);
        const active = c.effective_status === "ACTIVE";
        campaigns.push({
          campaignId: id,
          name: String(c.name ?? id),
          funnel,
          status: c.effective_status ? String(c.effective_status) : null,
          dailyBudgetCents: active ? toInt(c.daily_budget) || adsetBudget.get(id) || null : null,
          spendCents: toCents(r?.spend),
          impressions: toInt(r?.impressions),
          clicks: toInt(r?.clicks),
          linkClicks: toInt(r?.inline_link_clicks),
          metaLeads: toInt((r?.actions ?? []).find((a: any) => a?.action_type === "lead")?.value),
        });
      }
      for (const r of daily.rows) {
        if (isClientCampaign(r.campaign_name)) continue;
        const k = `${r.date_start}:${funnel}`;
        dailySpendCents[k] = (dailySpendCents[k] ?? 0) + toCents(r.spend);
      }
      // Reading pixel stats takes more access than reading ads, so a failure here
      // only blanks that column.
      if (stats.error) pixelEvents = null;
      else if (pixelEvents) {
        for (const bucket of stats.rows) {
          for (const d of bucket?.data ?? []) {
            const name = String(d?.value ?? "");
            if (name) pixelEvents[name] = (pixelEvents[name] ?? 0) + toInt(d?.count);
          }
        }
      }
    }),
  );

  const snap: MetaPerformance = { configured: true, campaigns, dailySpendCents, pixelEvents, missing, errors };
  if (!errors.length) perfCache.set(key, { at: Date.now(), snap });
  return snap;
}
