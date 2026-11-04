// Meta Marketing API writes for the Advertisely Ad Bulk Uploader (admin only).
//
// Client ad accounts, Pages and pixels are shared to Advertisely's Business
// Manager and assigned to one System User, so a single token reaches every
// client. Config (env — the raw token is never logged or returned):
//   META_ADS_MANAGE_TOKEN  System User token with ads_management,
//                          pages_show_list, pages_read_engagement,
//                          pages_manage_ads and leads_retrieval.
//                          Falls back to META_ADS_ACCESS_TOKEN if that token
//                          has been granted the same scopes.
//   META_GRAPH_VERSION     optional, defaults to v20.0 (same as metaInsights).
//   AD_UPLOADER_ACCOUNT_IDS optional comma list of ad accounts the uploader may
//                          touch. Defaults to ABCA (ABCA_AD_ACCOUNT_ID or
//                          2126340781245705) and Enhanced Wealth
//                          (ENHANCED_WEALTH_AD_ACCOUNT_ID or 2254810101392917).
//
// Everything this module creates is PAUSED — someone reviews in Ads Manager
// before any money is spent.

import { prisma, isDatabaseConfigured } from "./prisma";
import { stateNameForCode } from "./leadImport";
import { driveFileId, type MediaType, type SheetAd, type SheetAdSet, type SheetCampaign } from "./adBulkSheet";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const TOKEN = process.env.META_ADS_MANAGE_TOKEN || process.env.META_ADS_ACCESS_TOKEN;

export const FINANCIAL_CATEGORY = "FINANCIAL_PRODUCTS_SERVICES";

export function isAdUploaderConfigured(): boolean {
  return !!TOKEN;
}

export class MetaApiError extends Error {
  constructor(message: string, public code?: number, public subcode?: number) {
    super(message);
  }
}

const ALLOWED_ACCOUNTS = new Set(
  (
    process.env.AD_UPLOADER_ACCOUNT_IDS ||
    [
      process.env.ABCA_AD_ACCOUNT_ID || "2126340781245705",
      process.env.ENHANCED_WEALTH_AD_ACCOUNT_ID || "2254810101392917",
    ].join(",")
  )
    .split(",")
    .map((id) => id.replace(/^act_/, "").replace(/\D/g, ""))
    .filter(Boolean),
);

export function isAllowedAccount(accountId: string): boolean {
  return ALLOWED_ACCOUNTS.has(accountId.replace(/^act_/, "").replace(/\D/g, ""));
}

// Every Graph call against an ad account goes through here, so this is the lock.
function actId(accountId: string): string {
  const digits = accountId.replace(/^act_/, "").replace(/\D/g, "");
  if (!digits) throw new MetaApiError("Invalid ad account id.");
  if (!ALLOWED_ACCOUNTS.has(digits)) throw new MetaApiError("The bulk uploader only works with the American Blue Collar Advantage and Enhanced Wealth ad accounts.");
  return `act_${digits}`;
}

function graphError(data: any, status: number): MetaApiError {
  const e = data?.error ?? {};
  // error_user_msg is Meta's human-readable explanation; prefer it when present.
  const msg = [e.error_user_title, e.error_user_msg].filter(Boolean).join(": ") || e.message || `Graph API ${status}`;
  return new MetaApiError(msg, e.code, e.error_subcode);
}

async function graphGet<T = any>(path: string, params: Record<string, string> = {}, token = TOKEN): Promise<T> {
  if (!token) throw new MetaApiError("META_ADS_MANAGE_TOKEN is not set.");
  const qs = new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(`${GRAPH}/${path}?${qs}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw graphError(data, res.status);
  return data as T;
}

async function graphPost<T = any>(path: string, params: Record<string, unknown>): Promise<T> {
  if (!TOKEN) throw new MetaApiError("META_ADS_MANAGE_TOKEN is not set.");
  const body = new URLSearchParams({ access_token: TOKEN });
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    body.set(k, typeof v === "string" ? v : JSON.stringify(v));
  }
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw graphError(data, res.status);
  return data as T;
}

/** Follow `paging.next` until done (or `max` rows), for small admin lists. */
async function graphList<T>(path: string, params: Record<string, string>, max = 500): Promise<T[]> {
  const out: T[] = [];
  let page = await graphGet<{ data: T[]; paging?: { next?: string } }>(path, { limit: "100", ...params });
  out.push(...page.data);
  while (page.paging?.next && out.length < max) {
    const res = await fetch(page.paging.next, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw graphError(data, res.status);
    page = data;
    out.push(...page.data);
  }
  return out;
}

// ─── Lookups for the admin form ──────────────────────────────────────

export interface AdAccountOption {
  id: string; // act_123
  name: string;
  currency: string;
  active: boolean;
  business: string | null;
}

export async function listAdAccounts(): Promise<AdAccountOption[]> {
  const rows = await graphList<any>("me/adaccounts", { fields: "name,account_status,currency,business{name}" });
  return rows
    .filter((a) => isAllowedAccount(String(a.id ?? "")))
    .map((a) => ({
      id: a.id,
      name: a.name ?? a.id,
      currency: a.currency ?? "USD",
      active: a.account_status === 1,
      business: a.business?.name ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PageOption {
  id: string;
  name: string;
}

export async function listPages(): Promise<PageOption[]> {
  const rows = await graphList<any>("me/accounts", { fields: "name" });
  return rows.map((p) => ({ id: p.id, name: p.name ?? p.id })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function listPixels(accountId: string): Promise<PageOption[]> {
  const rows = await graphList<any>(`${actId(accountId)}/adspixels`, { fields: "name" });
  return rows.map((p) => ({ id: p.id, name: p.name ?? p.id }));
}

/**
 * A Page token minted from the System User token, or null when the System User
 * has no access to the Page. System-User Page tokens don't expire, so this is
 * also what Meta lead ingestion stores when a Page is connected without a
 * pasted token.
 */
export async function systemUserPageToken(pageId: string): Promise<string | null> {
  if (!TOKEN) return null;
  try {
    const p = await graphGet<{ access_token?: string }>(encodeURIComponent(pageId), { fields: "access_token" });
    return p.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Instant forms live on the Page and need a Page token. Ask Meta for one with
 * the System User token first; fall back to a token saved under Meta ingestion
 * (MetaPageConnection) for pages connected the older way.
 */
async function pageToken(pageId: string): Promise<string | null> {
  const fromSystemUser = await systemUserPageToken(pageId);
  if (fromSystemUser) return fromSystemUser;
  if (isDatabaseConfigured && prisma) {
    const row = await prisma.metaPageConnection.findUnique({ where: { pageId }, select: { pageAccessToken: true } });
    if (row?.pageAccessToken) return row.pageAccessToken;
  }
  return null;
}

export interface LeadFormOption {
  id: string;
  name: string;
  status: string;
}

export async function listLeadForms(pageId: string): Promise<LeadFormOption[]> {
  const token = await pageToken(pageId);
  if (!token) throw new MetaApiError("No access to this Page's instant forms. Assign the Page to the System User.");
  const data = await graphGet<{ data: any[] }>(
    `${encodeURIComponent(pageId)}/leadgen_forms`,
    { fields: "name,status", limit: "200" },
    token,
  );
  return data.data.map((f) => ({ id: f.id, name: f.name ?? f.id, status: f.status ?? "" }));
}

// ─── Media ───────────────────────────────────────────────────────────

/** Upload an image (base64, no data: prefix) to the account's image library. Returns its hash. */
export async function uploadImage(accountId: string, name: string, base64: string): Promise<string> {
  const data = await graphPost<{ images: Record<string, { hash: string }> }>(`${actId(accountId)}/adimages`, {
    bytes: base64,
    name,
  });
  const first = Object.values(data.images ?? {})[0];
  if (!first?.hash) throw new MetaApiError("Meta didn't return an image hash.");
  return first.hash;
}

/**
 * Google Drive answers with a sign-in or error page instead of the file unless
 * it's shared as "Anyone with the link". Check that (one byte, not the whole
 * file) so the admin gets a fix-it message instead of Meta's generic failure.
 */
async function checkDriveFile(url: string, want: MediaType): Promise<void> {
  if (!driveFileId(url)) return;
  const res = await fetch(url, { cache: "no-store", redirect: "follow", headers: { Range: "bytes=0-0" } });
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  await res.body?.cancel().catch(() => {});
  if (!res.ok || type.startsWith("text/html")) {
    throw new MetaApiError(
      'Google Drive won\'t share this file. In Drive, open it → Share → General access → "Anyone with the link", then run it again.',
    );
  }
  if (want === "video" && type.startsWith("image/")) throw new MetaApiError("This Drive file is an image. Set media_type to image for this row.");
  if (want === "image" && type.startsWith("video/")) throw new MetaApiError("This Drive file is a video. Clear media_type (or set it to video) for this row.");
}

/** Download an https image and upload it. Used for image links in the sheet. */
export async function uploadImageFromUrl(accountId: string, url: string): Promise<string> {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error();
    host = u.hostname;
  } catch {
    throw new MetaApiError(`${url} isn't a valid https:// link.`);
  }
  // Admin-only, but still never fetch our own network on the server's behalf.
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host) || /^[\d.]+$|^\[/.test(host)) {
    throw new MetaApiError(`${url} must be a public https:// link.`);
  }
  await checkDriveFile(url, "image");
  const res = await fetch(url, { cache: "no-store", redirect: "follow" });
  if (!res.ok) throw new MetaApiError(`Couldn't download ${url} (HTTP ${res.status}).`);
  const type = res.headers.get("content-type") ?? "";
  if (type && !type.startsWith("image/")) throw new MetaApiError(`${url} isn't an image (got ${type}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 30 * 1024 * 1024) throw new MetaApiError(`${url} is larger than 30 MB.`);
  const driveId = driveFileId(url);
  const name = driveId ? `drive-${driveId}` : decodeURIComponent(url.split(/[?#]/)[0].split("/").pop() || "image");
  return uploadImage(accountId, name, buf.toString("base64"));
}

/** Have Meta fetch a video from an https link. Processing is async — poll videoStatus(). */
export async function uploadVideoFromUrl(accountId: string, url: string, name: string): Promise<string> {
  await checkDriveFile(url, "video");
  const data = await graphPost<{ id: string }>(`${actId(accountId)}/advideos`, { file_url: url, name });
  if (!data.id) throw new MetaApiError("Meta didn't return a video id.");
  return data.id;
}

export interface VideoStatus {
  state: "processing" | "ready" | "error";
  thumbnailUrl: string | null;
  error?: string;
}

export async function videoStatus(videoId: string): Promise<VideoStatus> {
  const v = await graphGet<any>(encodeURIComponent(videoId), { fields: "status,thumbnails{uri,is_preferred}" });
  const s = v.status?.video_status as string | undefined;
  const thumbs: any[] = v.thumbnails?.data ?? [];
  const thumb = (thumbs.find((t) => t.is_preferred) ?? thumbs[0])?.uri ?? null;
  if (s === "error") {
    return { state: "error", thumbnailUrl: null, error: v.status?.processing_phase?.errors?.[0]?.message ?? "Meta couldn't process this video." };
  }
  // A creative needs a thumbnail, so "ready" means both processed and thumbnailed.
  return { state: s === "ready" && thumb ? "ready" : "processing", thumbnailUrl: thumb };
}

// ─── Campaign → ad set → ad ──────────────────────────────────────────

export interface CampaignContext {
  accountId: string;
  pageId: string;
  pixelId?: string;
  financialCategory: boolean;
}

export async function createCampaign(ctx: CampaignContext, c: Pick<SheetCampaign, "name" | "objective">): Promise<string> {
  const params: Record<string, unknown> = {
    name: c.name,
    objective: c.objective === "TRAFFIC" ? "OUTCOME_TRAFFIC" : "OUTCOME_LEADS",
    status: "PAUSED",
    buying_type: "AUCTION",
    special_ad_categories: ctx.financialCategory ? [FINANCIAL_CATEGORY] : [],
    special_ad_category_country: ctx.financialCategory ? ["US"] : undefined,
  };
  try {
    return (await graphPost<{ id: string }>(`${actId(ctx.accountId)}/campaigns`, params)).id;
  } catch (e) {
    // Newer Graph versions require this flag on campaigns that budget at the
    // ad-set level; older ones reject it. Retry with it only when Meta asks.
    if (e instanceof MetaApiError && /is_adset_budget_sharing_enabled/i.test(e.message)) {
      params.is_adset_budget_sharing_enabled = false;
      return (await graphPost<{ id: string }>(`${actId(ctx.accountId)}/campaigns`, params)).id;
    }
    throw e;
  }
}

// State code → Meta region key (e.g. FL → "3847"). Stable, so cache per process.
const regionKeyCache = new Map<string, string>();

export async function regionKeys(codes: string[]): Promise<{ key: string }[]> {
  const out: { key: string }[] = [];
  for (const code of codes) {
    let key = regionKeyCache.get(code);
    if (!key) {
      const name = stateNameForCode(code);
      if (!name) throw new MetaApiError(`Unknown state ${code}.`);
      const res = await graphGet<{ data: any[] }>("search", {
        type: "adgeolocation",
        location_types: JSON.stringify(["region"]),
        country_code: "US",
        q: name,
        limit: "10",
      });
      const hit = res.data.find((r) => r.type === "region" && r.country_code === "US" && String(r.name).toLowerCase() === name.toLowerCase());
      if (!hit) throw new MetaApiError(`Meta has no targeting region for ${name}.`);
      key = String(hit.key);
      regionKeyCache.set(code, key);
    }
    out.push({ key });
  }
  return out;
}

export async function createAdSet(
  ctx: CampaignContext,
  campaignId: string,
  objective: SheetCampaign["objective"],
  s: SheetAdSet,
): Promise<string> {
  const targeting: Record<string, unknown> = {
    geo_locations: s.states.length ? { regions: await regionKeys(s.states) } : { countries: ["US"] },
    age_min: ctx.financialCategory ? 18 : s.ageMin,
    age_max: ctx.financialCategory ? 65 : s.ageMax,
    targeting_automation: { advantage_audience: 0 },
  };

  let optimization_goal: string;
  let destination_type: string | undefined;
  let promoted_object: Record<string, string> | undefined;
  if (objective === "TRAFFIC") {
    optimization_goal = "LINK_CLICKS";
    destination_type = "WEBSITE";
  } else if (s.destination === "FORM") {
    optimization_goal = "LEAD_GENERATION";
    destination_type = "ON_AD";
    promoted_object = { page_id: ctx.pageId };
  } else {
    if (!ctx.pixelId) throw new MetaApiError("Pick a pixel: website lead ad sets optimize for the pixel's Lead event.");
    optimization_goal = "OFFSITE_CONVERSIONS";
    destination_type = "WEBSITE";
    promoted_object = { pixel_id: ctx.pixelId, custom_event_type: "LEAD" };
  }

  const data = await graphPost<{ id: string }>(`${actId(ctx.accountId)}/adsets`, {
    name: s.name,
    campaign_id: campaignId,
    daily_budget: String(s.dailyBudgetCents),
    billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    optimization_goal,
    destination_type,
    promoted_object,
    targeting,
    start_time: s.startDate ? `${s.startDate}T00:00:00-0600` : undefined,
    status: "PAUSED",
  });
  return data.id;
}

export interface AdMedia {
  imageHash?: string;
  videoId?: string;
  thumbnailUrl?: string;
}

/** Create the creative and the (paused) ad that uses it. */
export async function createAd(
  ctx: CampaignContext,
  adsetId: string,
  adset: Pick<SheetAdSet, "destination" | "leadFormId">,
  ad: SheetAd,
  media: AdMedia,
): Promise<{ adId: string; creativeId: string }> {
  const isForm = adset.destination === "FORM";
  // Instant-form ads still need a link; Meta's documented placeholder is fb.me.
  const link = isForm ? ad.linkUrl || "http://fb.me/" : ad.linkUrl;
  const call_to_action = {
    type: ad.cta,
    value: isForm ? { lead_gen_form_id: adset.leadFormId } : { link },
  };

  let story: Record<string, unknown>;
  if (ad.mediaType === "video") {
    if (!media.videoId || !media.thumbnailUrl) throw new MetaApiError("Video isn't ready yet.");
    story = {
      page_id: ctx.pageId,
      video_data: {
        video_id: media.videoId,
        image_url: media.thumbnailUrl,
        message: ad.primaryText,
        title: ad.headline || undefined,
        link_description: ad.description || undefined,
        call_to_action,
      },
    };
  } else {
    if (!media.imageHash) throw new MetaApiError("Image wasn't uploaded.");
    story = {
      page_id: ctx.pageId,
      link_data: {
        image_hash: media.imageHash,
        link,
        message: ad.primaryText,
        name: ad.headline || undefined,
        description: ad.description || undefined,
        call_to_action,
      },
    };
  }

  const creative = await graphPost<{ id: string }>(`${actId(ctx.accountId)}/adcreatives`, {
    name: `${ad.name} – creative`,
    object_story_spec: story,
    url_tags: ad.urlTags || undefined,
  });
  const created = await graphPost<{ id: string }>(`${actId(ctx.accountId)}/ads`, {
    name: ad.name,
    adset_id: adsetId,
    creative: { creative_id: creative.id },
    status: "PAUSED",
  });
  return { adId: created.id, creativeId: creative.id };
}

export function adsManagerUrl(accountId: string, campaignId?: string): string {
  const act = actId(accountId).replace(/^act_/, "");
  const sel = campaignId ? `&selected_campaign_ids=${encodeURIComponent(campaignId)}` : "";
  return `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${act}${sel}`;
}
