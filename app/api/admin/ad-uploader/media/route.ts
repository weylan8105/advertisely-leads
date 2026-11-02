import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  isAdUploaderConfigured,
  uploadImage,
  uploadImageFromUrl,
  uploadVideoFromUrl,
  videoStatus,
} from "@/lib/metaAds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isAdUploaderConfigured()) return NextResponse.json({ error: "META_ADS_MANAGE_TOKEN is not set." }, { status: 503 });
  return null;
}

/**
 * POST /api/admin/ad-uploader/media — put one creative into a client's ad account.
 *   { accountId, kind: "image-file", name, base64 } → { imageHash }
 *   { accountId, kind: "image-url", url }           → { imageHash }
 *   { accountId, kind: "video-url", url, name }     → { videoId }  (then poll GET)
 * The browser sends image files one at a time as base64 to stay under the
 * serverless request-size limit. Admin only.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const body = await req.json().catch(() => null);
  const accountId = String(body?.accountId ?? "");
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  try {
    switch (body?.kind) {
      case "image-file": {
        const base64 = String(body.base64 ?? "").replace(/^data:[^,]*,/, "");
        if (!base64) return NextResponse.json({ error: "base64 is required" }, { status: 400 });
        return NextResponse.json({ imageHash: await uploadImage(accountId, String(body.name || "image"), base64) });
      }
      case "image-url":
        return NextResponse.json({ imageHash: await uploadImageFromUrl(accountId, String(body.url ?? "")) });
      case "video-url": {
        const url = String(body.url ?? "");
        if (!/^https:\/\//i.test(url)) return NextResponse.json({ error: "Video links must use https://" }, { status: 400 });
        return NextResponse.json({ videoId: await uploadVideoFromUrl(accountId, url, String(body.name || "video")) });
      }
      default:
        return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** GET /api/admin/ad-uploader/media?videoId=… → { state, thumbnailUrl, error? } */
export async function GET(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const videoId = new URL(req.url).searchParams.get("videoId");
  if (!videoId) return NextResponse.json({ error: "videoId is required" }, { status: 400 });
  try {
    return NextResponse.json(await videoStatus(videoId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
