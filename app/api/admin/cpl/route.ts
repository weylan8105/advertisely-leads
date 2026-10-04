import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getEnhancedWealthCpl } from "@/lib/metaInsights";
import { findPackage } from "@/data/packages";
import { freshFloorCents, applyFreshFloor, CPL_PRICE_MULTIPLIER, HARD_MIN_FRESH_CENTS } from "@/lib/cplPricing";

// The canonical admin that holds the global manual-CPL value (oldest ADMIN).
async function canonicalAdmin() {
  if (!prisma) return null;
  return prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, manualCplCents: true, manualCplUpdatedAt: true },
  });
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/cpl[?refresh=1]
 * Current Facebook cost-per-lead for the Enhanced Wealth ad account + the fresh
 * price floor it implies (2x CPL, min $55). Read-only; does not change prices.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const snap = await getEnhancedWealthCpl({ force: refresh });

  // Manual CPL fallback: when the Meta API isn't connected (or returns no CPL),
  // use the admin-entered value so the floor still works.
  const admin = await canonicalAdmin();
  const manualCplCents = admin?.manualCplCents ?? null;
  const metaCpl = snap.configured ? snap.cplCents : null;
  const effectiveCpl = metaCpl ?? manualCplCents;
  const cplSource: "meta" | "manual" | "none" =
    metaCpl != null ? "meta" : manualCplCents != null ? "manual" : "none";

  const fresh = findPackage("iul-fresh");
  const baseFreshCents = Math.round((fresh?.pricePerLead ?? 0) * 100);
  const floorCents = freshFloorCents(effectiveCpl);
  const effectiveFreshCents = applyFreshFloor(baseFreshCents, effectiveCpl);

  return NextResponse.json({
    ...snap,
    cplCents: effectiveCpl, // resolved CPL (meta if live, else manual)
    cplSource,
    manualCplCents,
    manualCplUpdatedAt: admin?.manualCplUpdatedAt ?? null,
    multiplier: CPL_PRICE_MULTIPLIER,
    hardMinCents: HARD_MIN_FRESH_CENTS,
    baseFreshCents,
    floorCents, // max(2x CPL, $55)
    effectiveFreshCents, // what the floor would make the fresh price (max of base + floor)
    floorAboveBase: effectiveFreshCents > baseFreshCents,
  });
}

/**
 * POST /api/admin/cpl — set (or clear) the manual CPL. Body: { cplDollars: number }
 * or { clear: true }. Stored on the canonical admin as the global value.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const admin = await canonicalAdmin();
  if (!admin) return NextResponse.json({ error: "No admin account found" }, { status: 400 });

  if (body.clear === true) {
    await prisma.user.update({ where: { id: admin.id }, data: { manualCplCents: null, manualCplUpdatedAt: new Date() } });
    return NextResponse.json({ ok: true, manualCplCents: null });
  }

  const dollars = Number(body.cplDollars);
  if (!Number.isFinite(dollars) || dollars < 0 || dollars > 10000) {
    return NextResponse.json({ error: "Enter a valid CPL (dollars per lead)." }, { status: 400 });
  }
  const cents = Math.round(dollars * 100);
  await prisma.user.update({
    where: { id: admin.id },
    data: { manualCplCents: cents, manualCplUpdatedAt: new Date() },
  });
  return NextResponse.json({ ok: true, manualCplCents: cents });
}
