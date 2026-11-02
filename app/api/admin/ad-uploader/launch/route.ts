import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { parseAdSheet } from "@/lib/adBulkSheet";
import {
  isAdUploaderConfigured,
  createCampaign,
  createAdSet,
  createAd,
  adsManagerUrl,
  type CampaignContext,
} from "@/lib/metaAds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/admin/ad-uploader/launch — create ONE object in Meta, always PAUSED.
 * The browser walks the sheet step by step so each request stays short:
 *   { step: "campaign", c }                       → { id, url }
 *   { step: "adset",    c, s, campaignId }        → { id }
 *   { step: "ad",       c, s, a, adsetId, media } → { id, creativeId }
 * Every request carries the raw sheet; the server re-parses and re-validates it
 * and picks the item by index, so nothing the browser shaped is trusted.
 * Body also needs { csv, accountId, pageId, pixelId?, financialCategory }.
 * Admin only.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isAdUploaderConfigured()) return NextResponse.json({ error: "META_ADS_MANAGE_TOKEN is not set." }, { status: 503 });

  const body = await req.json().catch(() => null);
  if (!body?.csv || !body?.accountId || !body?.pageId) {
    return NextResponse.json({ error: "csv, accountId and pageId are required" }, { status: 400 });
  }
  const ctx: CampaignContext = {
    accountId: String(body.accountId),
    pageId: String(body.pageId),
    pixelId: body.pixelId ? String(body.pixelId) : undefined,
    financialCategory: !!body.financialCategory,
  };

  const sheet = parseAdSheet(String(body.csv), { financialCategory: ctx.financialCategory, uploadedFiles: null });
  if (sheet.issues.some((i) => i.level === "error")) {
    return NextResponse.json({ error: "The sheet has errors. Fix them and preview again." }, { status: 400 });
  }
  const campaign = sheet.campaigns[Number(body.c)];
  if (!campaign) return NextResponse.json({ error: "Campaign not found in sheet" }, { status: 400 });

  try {
    if (body.step === "campaign") {
      const id = await createCampaign(ctx, campaign);
      return NextResponse.json({ id, url: adsManagerUrl(ctx.accountId, id) });
    }

    const adset = campaign.adsets[Number(body.s)];
    if (!adset) return NextResponse.json({ error: "Ad set not found in sheet" }, { status: 400 });

    if (body.step === "adset") {
      if (!body.campaignId) return NextResponse.json({ error: "campaignId is required" }, { status: 400 });
      return NextResponse.json({ id: await createAdSet(ctx, String(body.campaignId), campaign.objective, adset) });
    }

    if (body.step === "ad") {
      const ad = adset.ads[Number(body.a)];
      if (!ad) return NextResponse.json({ error: "Ad not found in sheet" }, { status: 400 });
      if (!body.adsetId) return NextResponse.json({ error: "adsetId is required" }, { status: 400 });
      const media = body.media ?? {};
      const r = await createAd(ctx, String(body.adsetId), adset, ad, {
        imageHash: media.imageHash ? String(media.imageHash) : undefined,
        videoId: media.videoId ? String(media.videoId) : undefined,
        thumbnailUrl: media.thumbnailUrl ? String(media.thumbnailUrl) : undefined,
      });
      return NextResponse.json({ id: r.adId, creativeId: r.creativeId });
    }

    return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
