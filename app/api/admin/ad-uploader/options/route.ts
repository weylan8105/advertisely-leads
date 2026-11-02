import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdUploaderConfigured, listAdAccounts, listPages, listPixels, listLeadForms } from "@/lib/metaAds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/ad-uploader/options — what the Ad Bulk Uploader form can pick:
 *   (no params)      → ad accounts + Pages the System User can reach
 *   ?accountId=act_1 → that account's pixels
 *   ?pageId=123      → that Page's instant forms
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isAdUploaderConfigured()) return NextResponse.json({ configured: false });

  const params = new URL(req.url).searchParams;
  const accountId = params.get("accountId");
  const pageId = params.get("pageId");
  try {
    if (accountId) return NextResponse.json({ configured: true, pixels: await listPixels(accountId) });
    if (pageId) return NextResponse.json({ configured: true, forms: await listLeadForms(pageId) });
    const [accounts, pages] = await Promise.all([listAdAccounts(), listPages()]);
    return NextResponse.json({ configured: true, accounts, pages });
  } catch (e) {
    return NextResponse.json({ configured: true, error: (e as Error).message }, { status: 502 });
  }
}
