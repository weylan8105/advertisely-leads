import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { listLicensedPartners, renderLicensedPartnersPage, type LicensedPartner } from "@/lib/licensedPartners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /licensed-partners — public Licensed Partners page linked from the
 * funnels' footers, consent box, Privacy Policy and Terms. Standalone HTML
 * (no app chrome) styled like the funnel pages; ?site=hwa brands it for HWA.
 * Cached at the edge for 10 minutes so ad traffic never hammers the DB.
 */
export async function GET(req: NextRequest) {
  const site = new URL(req.url).searchParams.get("site") === "hwa" ? "hwa" : "abca";

  let partners: LicensedPartner[] = [];
  if (isDatabaseConfigured && prisma) {
    try {
      partners = await listLicensedPartners(prisma);
    } catch (err) {
      console.error(`[licensed-partners] ${(err as Error).message}`);
    }
  }

  return new NextResponse(renderLicensedPartnersPage({ partners, site, generatedAt: new Date() }), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, s-maxage=600, stale-while-revalidate=3600",
    },
  });
}
