import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { leadPackages, IUL_POOL_IDS } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inventory[?states=TX,FL] — live unassigned-lead counts per age tier.
 * Optional `states` filter returns availability just for those states (used to
 * cap orders + show accurate per-state availability). Public (counts only).
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ tiers: {}, updatedAt: new Date().toISOString() });
  }

  const statesParam = new URL(req.url).searchParams.get("states");
  const states = (statesParam ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  // The age tiers (visible packages with an age window), and the raw ages of
  // every matching unassigned IUL lead — one query, bucketed in memory.
  const tiers = leadPackages.filter(
    (p) => !p.hidden && (p.ageMinDays != null || p.ageMaxDays != null),
  );
  const leads = await prisma.lead.findMany({
    where: {
      assignedUserId: null,
      orderId: null,
      packageId: { in: IUL_POOL_IDS },
      ...(states.length ? { state: { in: states } } : {}),
    },
    select: { receivedAt: true },
  });

  const DAY = 86_400_000;
  const now = Date.now();
  const ages = leads.map((l) => (now - new Date(l.receivedAt).getTime()) / DAY);

  const out: Record<string, number> = {};
  for (const t of tiers) {
    const min = t.ageMinDays ?? 0;
    const max = t.ageMaxDays ?? Infinity; // exclusive upper edge
    out[t.id] = ages.filter((a) => a >= min && a < max).length;
  }

  return NextResponse.json({
    tiers: out,
    total: leads.length,
    states,
    updatedAt: new Date().toISOString(),
  });
}
