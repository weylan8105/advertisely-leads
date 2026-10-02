import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getEnhancedWealthCpl } from "@/lib/metaInsights";
import { findPackage } from "@/data/packages";
import { freshFloorCents, applyFreshFloor, CPL_PRICE_MULTIPLIER, HARD_MIN_FRESH_CENTS } from "@/lib/cplPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cpl[?refresh=1]
 * Current Facebook cost-per-lead for the Enhanced Wealth ad account + the fresh
 * price floor it implies (2x CPL, min $45). Read-only; does not change prices.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const snap = await getEnhancedWealthCpl({ force: refresh });

  const fresh = findPackage("iul-fresh");
  const baseFreshCents = Math.round((fresh?.pricePerLead ?? 0) * 100);
  const floorCents = freshFloorCents(snap.cplCents);
  const effectiveFreshCents = applyFreshFloor(baseFreshCents, snap.cplCents);

  return NextResponse.json({
    ...snap,
    multiplier: CPL_PRICE_MULTIPLIER,
    hardMinCents: HARD_MIN_FRESH_CENTS,
    baseFreshCents,
    floorCents, // max(2x CPL, $45)
    effectiveFreshCents, // what the floor would make the fresh price (max of base + floor)
    floorAboveBase: effectiveFreshCents > baseFreshCents,
  });
}
