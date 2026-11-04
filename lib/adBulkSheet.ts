// Advertisely Ad Bulk Uploader — the sheet format and its validator.
//
// One CSV row = one ad. Rows that share a campaign_name belong to one campaign,
// and rows that share (campaign_name, adset_name) belong to one ad set, so
// campaign/ad-set columns simply repeat down the sheet. Pure and client-safe:
// the admin page uses it for the live preview and the API re-runs it before
// anything is sent to Meta.

import { parseCsv, normalizeState } from "./leadImport";

export type Objective = "LEADS" | "TRAFFIC";
export type Destination = "FORM" | "WEBSITE";
export type MediaType = "image" | "video";

export const CTA_TYPES = [
  "LEARN_MORE",
  "SIGN_UP",
  "APPLY_NOW",
  "GET_QUOTE",
  "CONTACT_US",
  "BOOK_NOW",
  "GET_OFFER",
  "SUBSCRIBE",
  "DOWNLOAD",
] as const;
export type CtaType = (typeof CTA_TYPES)[number];

/** Columns in the order the template lists them. Required ones are marked. */
export const SHEET_COLUMNS: { key: string; required?: boolean; help: string }[] = [
  { key: "campaign_name", required: true, help: "Rows with the same name go into one campaign." },
  { key: "objective", help: "LEADS (default) or TRAFFIC." },
  { key: "adset_name", required: true, help: "Rows with the same campaign + ad set name go into one ad set." },
  { key: "daily_budget", required: true, help: "Ad set daily budget in dollars, e.g. 50." },
  { key: "destination", help: "FORM (instant form, default for LEADS) or WEBSITE." },
  { key: "lead_form_id", help: "Instant form ID. Required when destination is FORM." },
  { key: "states", help: "2-letter codes separated by ; (FL;TX). Blank = all of the US." },
  { key: "age_min", help: "18–65. Ignored under the Financial products special ad category." },
  { key: "age_max", help: "18–65 (65 means 65+). Ignored under the Financial products category." },
  { key: "start_date", help: "Optional YYYY-MM-DD. Blank = starts when you turn it on." },
  { key: "ad_name", required: true, help: "Name of the ad in Ads Manager." },
  { key: "media", required: true, help: "File name of an uploaded image, or an https:// link to an image or video (Google Drive share links work; share them as \"Anyone with the link\")." },
  { key: "media_type", help: "image or video. Only needed when a link has no file extension. Google Drive links count as video unless this says image." },
  { key: "primary_text", required: true, help: "The main ad copy." },
  { key: "headline", help: "Headline under the creative." },
  { key: "description", help: "Short line under the headline." },
  { key: "cta", help: `Button: ${CTA_TYPES.join(", ")}. Default LEARN_MORE.` },
  { key: "link_url", help: "Landing page. Required when destination is WEBSITE." },
  { key: "url_tags", help: "Optional tracking params, e.g. utm_source=facebook&utm_content={{ad.id}}." },
];

export interface SheetAd {
  row: number;
  name: string;
  media: string;
  mediaType: MediaType;
  /** True when `media` is an https:// link rather than an uploaded file name. */
  mediaIsUrl: boolean;
  primaryText: string;
  headline: string;
  description: string;
  cta: CtaType;
  linkUrl: string;
  urlTags: string;
}

export interface SheetAdSet {
  row: number;
  name: string;
  dailyBudgetCents: number;
  destination: Destination;
  leadFormId: string;
  states: string[];
  ageMin: number;
  ageMax: number;
  startDate: string;
  ads: SheetAd[];
}

export interface SheetCampaign {
  row: number;
  name: string;
  objective: Objective;
  adsets: SheetAdSet[];
}

export interface SheetIssue {
  row: number; // 1-based sheet row (header = row 1); 0 = whole sheet
  level: "error" | "warning";
  message: string;
}

export interface ParsedSheet {
  campaigns: SheetCampaign[];
  issues: SheetIssue[];
  adCount: number;
  adsetCount: number;
}

export interface ParseOptions {
  /** Financial products & services special ad category: age targeting is locked to 18–65+. */
  financialCategory: boolean;
  /** Lower-cased names of the image files the admin attached. Null = don't check. */
  uploadedFiles?: Set<string> | null;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|avi|webm|mkv)$/i;

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function stripUrlQuery(u: string): string {
  return u.split(/[?#]/)[0];
}

const DRIVE_HOSTS = new Set(["drive.google.com", "docs.google.com", "drive.usercontent.google.com"]);

function driveUrl(link: string): URL | null {
  try {
    const u = new URL(link);
    return DRIVE_HOSTS.has(u.hostname.toLowerCase()) ? u : null;
  } catch {
    return null;
  }
}

/** File ID from a Google Drive share/download link, or null when it isn't one. */
export function driveFileId(link: string): string | null {
  const u = driveUrl(link);
  if (!u) return null;
  const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] ?? u.searchParams.get("id");
  return id && /^[\w-]{10,}$/.test(id) ? id : null;
}

/**
 * Direct download for a Drive file that both our server and Meta can fetch.
 * confirm=t skips the "can't scan this file for viruses" page Drive shows for big videos.
 */
export function driveDownloadUrl(id: string): string {
  return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
}

export function mediaTypeFor(media: string, explicit: string): MediaType | null {
  const e = explicit.trim().toLowerCase();
  if (e === "image" || e === "video") return e;
  const path = /^https?:\/\//i.test(media) ? stripUrlQuery(media) : media;
  if (IMAGE_EXT.test(path)) return "image";
  if (VIDEO_EXT.test(path)) return "video";
  return null;
}

function parseBudgetCents(raw: string): number | null {
  const n = Number(raw.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function parseAge(raw: string, fallback: number): number | null {
  if (!raw.trim()) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 18 && n <= 65 ? n : null;
}

/** Parse and validate a bulk-upload sheet. Never throws; problems come back as issues. */
export function parseAdSheet(text: string, opts: ParseOptions): ParsedSheet {
  const issues: SheetIssue[] = [];
  const err = (row: number, message: string) => issues.push({ row, level: "error", message });
  const warn = (row: number, message: string) => issues.push({ row, level: "warning", message });

  const rows = parseCsv(text);
  if (rows.length < 2) {
    err(0, "The sheet needs a header row and at least one ad row.");
    return { campaigns: [], issues, adCount: 0, adsetCount: 0 };
  }

  const header = rows[0].map(normHeader);
  const known = new Set(SHEET_COLUMNS.map((c) => c.key));
  for (const c of SHEET_COLUMNS.filter((c) => c.required)) {
    if (!header.includes(c.key)) err(1, `Missing required column "${c.key}".`);
  }
  const unknown = header.filter((h) => h && !known.has(h));
  if (unknown.length) warn(1, `Ignoring unknown column(s): ${unknown.join(", ")}.`);
  if (issues.some((i) => i.level === "error")) {
    return { campaigns: [], issues, adCount: 0, adsetCount: 0 };
  }

  const campaigns = new Map<string, SheetCampaign>();
  const adsets = new Map<string, SheetAdSet>();
  const adNames = new Set<string>();
  let adCount = 0;

  rows.slice(1).forEach((cells, idx) => {
    const row = idx + 2;
    const get = (key: string) => (cells[header.indexOf(key)] ?? "").trim();
    let ok = true;
    const fail = (m: string) => { err(row, m); ok = false; };

    // ── Campaign ──
    const campaignName = get("campaign_name");
    if (!campaignName) fail("campaign_name is empty.");
    const objRaw = (get("objective") || "LEADS").toUpperCase();
    const objective: Objective | null = objRaw === "LEADS" || objRaw === "TRAFFIC" ? objRaw : null;
    if (!objective) fail(`objective "${get("objective")}" must be LEADS or TRAFFIC.`);

    let campaign = campaigns.get(campaignName);
    if (campaignName && objective) {
      if (!campaign) {
        campaign = { row, name: campaignName, objective, adsets: [] };
        campaigns.set(campaignName, campaign);
      } else if (get("objective") && campaign.objective !== objective) {
        fail(`objective ${objective} conflicts with ${campaign.objective} set on row ${campaign.row} for this campaign.`);
      }
    }
    const effObjective = campaign?.objective ?? objective ?? "LEADS";

    // ── Ad set ──
    const adsetName = get("adset_name");
    if (!adsetName) fail("adset_name is empty.");
    const adsetKey = `${campaignName}\u0000${adsetName}`;
    let adset = adsets.get(adsetKey);

    if (!adset) {
      const budget = parseBudgetCents(get("daily_budget"));
      if (budget == null) fail(`daily_budget "${get("daily_budget")}" must be a dollar amount above 0.`);
      else if (budget < 100) fail("daily_budget must be at least $1.");

      const destRaw = (get("destination") || (effObjective === "LEADS" ? "FORM" : "WEBSITE")).toUpperCase();
      const destination: Destination | null = destRaw === "FORM" || destRaw === "WEBSITE" ? destRaw : null;
      if (!destination) fail(`destination "${get("destination")}" must be FORM or WEBSITE.`);
      if (effObjective === "TRAFFIC" && destination === "FORM") fail("TRAFFIC campaigns can't use an instant form; set destination to WEBSITE.");

      const leadFormId = get("lead_form_id").replace(/\D/g, "");
      if (destination === "FORM" && !leadFormId) fail("lead_form_id is required for instant-form ad sets.");

      const states: string[] = [];
      for (const part of get("states").split(/[;,|]/).map((s) => s.trim()).filter(Boolean)) {
        const { code, unknown } = normalizeState(part);
        if (!code || unknown) fail(`Unknown state "${part}".`);
        else if (!states.includes(code)) states.push(code);
      }

      let ageMin = parseAge(get("age_min"), 18);
      let ageMax = parseAge(get("age_max"), 65);
      if (ageMin == null) fail(`age_min "${get("age_min")}" must be between 18 and 65.`);
      if (ageMax == null) fail(`age_max "${get("age_max")}" must be between 18 and 65.`);
      if (ageMin != null && ageMax != null && ageMin > ageMax) fail("age_min is greater than age_max.");
      if (opts.financialCategory && (get("age_min") || get("age_max"))) {
        warn(row, "Age targeting is ignored under the Financial products category (Meta requires 18–65+).");
        ageMin = 18;
        ageMax = 65;
      }

      const startDate = get("start_date");
      if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) fail(`start_date "${startDate}" must be YYYY-MM-DD.`);

      if (ok && campaign) {
        adset = {
          row,
          name: adsetName,
          dailyBudgetCents: budget!,
          destination: destination!,
          leadFormId,
          states,
          ageMin: ageMin!,
          ageMax: ageMax!,
          startDate,
          ads: [],
        };
        adsets.set(adsetKey, adset);
        campaign.adsets.push(adset);
      }
    } else {
      // Later rows of an existing ad set may leave ad-set columns blank, but must not contradict them.
      const budget = get("daily_budget") ? parseBudgetCents(get("daily_budget")) : null;
      if (budget != null && budget !== adset.dailyBudgetCents) {
        fail(`daily_budget differs from row ${adset.row} for the same ad set.`);
      }
      const form = get("lead_form_id").replace(/\D/g, "");
      if (form && form !== adset.leadFormId) fail(`lead_form_id differs from row ${adset.row} for the same ad set.`);
    }

    // ── Ad ──
    const adName = get("ad_name");
    if (!adName) fail("ad_name is empty.");
    else if (adNames.has(`${adsetKey}\u0000${adName}`)) warn(row, `Duplicate ad name "${adName}" in this ad set.`);

    // Google Drive share links open a viewer page, so swap in the file's direct download.
    let media = get("media");
    const driveId = driveFileId(media);
    if (driveId) media = driveDownloadUrl(driveId);
    const mediaIsUrl = /^https?:\/\//i.test(media);
    const mediaType = !media ? null : driveId ? (mediaTypeFor("", get("media_type")) ?? "video") : mediaTypeFor(media, get("media_type"));
    if (!media) fail("media is empty.");
    else if (!driveId && driveUrl(media)) fail(`"${media}" isn't a Drive file link. Link each file (Share → Copy link), not a folder.`);
    else if (/^http:\/\//i.test(media)) fail("Media links must use https://.");
    else if (!mediaType) fail(`Can't tell if "${media}" is an image or video; set media_type.`);
    else if (!mediaIsUrl && mediaType === "video") {
      fail(`Video "${media}" must be an https:// link (direct video file upload isn't supported yet).`);
    } else if (!mediaIsUrl && opts.uploadedFiles && !opts.uploadedFiles.has(media.toLowerCase())) {
      fail(`Image "${media}" hasn't been added to the upload.`);
    }

    const primaryText = get("primary_text");
    if (!primaryText) fail("primary_text is empty.");
    else if (primaryText.length > 2200) fail("primary_text is longer than 2,200 characters.");
    const headline = get("headline");
    if (headline.length > 255) fail("headline is longer than 255 characters.");
    else if (headline.length > 40) warn(row, "headline is over 40 characters and may be cut off.");

    const ctaRaw = (get("cta") || "LEARN_MORE").toUpperCase().replace(/\s+/g, "_");
    const cta = (CTA_TYPES as readonly string[]).includes(ctaRaw) ? (ctaRaw as CtaType) : null;
    if (!cta) fail(`cta "${get("cta")}" isn't supported. Use one of: ${CTA_TYPES.join(", ")}.`);

    const linkUrl = get("link_url");
    const dest = adset?.destination;
    if (dest === "WEBSITE" && !linkUrl) fail("link_url is required for WEBSITE ad sets.");
    if (linkUrl && !/^https:\/\/\S+\.\S+/i.test(linkUrl)) fail(`link_url "${linkUrl}" must be a full https:// URL.`);

    if (ok && adset) {
      adNames.add(`${adsetKey}\u0000${adName}`);
      adset.ads.push({
        row,
        name: adName,
        media,
        mediaType: mediaType!,
        mediaIsUrl,
        primaryText,
        headline,
        description: get("description"),
        cta: cta!,
        linkUrl,
        urlTags: get("url_tags").replace(/^\?/, ""),
      });
      adCount++;
    }
  });

  // Drop ad sets / campaigns left empty because all their rows failed.
  const out = [...campaigns.values()]
    .map((c) => ({ ...c, adsets: c.adsets.filter((a) => a.ads.length > 0) }))
    .filter((c) => c.adsets.length > 0);

  return {
    campaigns: out,
    issues: issues.sort((a, b) => a.row - b.row),
    adCount,
    adsetCount: out.reduce((n, c) => n + c.adsets.length, 0),
  };
}

/** A ready-to-fill template with two example ads in one instant-form ad set. */
export function adSheetTemplate(): string {
  const header = SHEET_COLUMNS.map((c) => c.key);
  const example = (o: Record<string, string>) =>
    header.map((k) => {
      const v = o[k] ?? "";
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(",");
  const base = {
    campaign_name: "Client Name – IUL Leads – Nov",
    objective: "LEADS",
    adset_name: "FL TX GA – 35-60",
    daily_budget: "50",
    destination: "FORM",
    lead_form_id: "123456789012345",
    states: "FL;TX;GA",
    age_min: "35",
    age_max: "60",
    cta: "LEARN_MORE",
  };
  return [
    header.join(","),
    example({
      ...base,
      ad_name: "Pension gap – image 1",
      media: "pension-gap.jpg",
      primary_text: "Working a trade? See how much tax-free retirement income you could build.",
      headline: "See your numbers in 60 seconds",
      description: "Free, no obligation",
    }),
    example({
      ...base,
      ad_name: "Lineman story – video",
      media: "https://example.com/videos/lineman-story.mp4",
      primary_text: "A lineman's plan to retire early, without touching his 401(k).",
      headline: "Get your free quote",
    }),
  ].join("\n") + "\n";
}
