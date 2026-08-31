import { NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { leadPackages, IUL_POOL_IDS } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/inventory — live unassigned-lead counts per age tier.
 * Public (counts only, no lead data). Powers the marketplace's real-time
 * availability display.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ tiers: {}, updatedAt: new Date().toISOString() });
  }

  // The age tiers (visible packages with an age window), and the raw ages of
  // every unassigned IUL lead — one query, bucketed in memory.
  const tiers = leadPackages.filter(
    (p) => !p.hidden && (p.ageMinDays != null || p.ageMaxDays != null),
  );
  const leads = await prisma.lead.findMany({
    where: { assignedUserId: null, orderId: null, packageId: { in: IUL_POOL_IDS } },
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

  return NextResponse.json({ tiers: out, total: leads.length, updatedAt: new Date().toISOString() });
}
