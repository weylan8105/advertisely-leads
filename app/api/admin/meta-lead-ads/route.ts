import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fillLeadAd } from "@/lib/metaLeadId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta keeps form leads for 90 days.
const WINDOW_MS = 90 * 86_400_000;
// Answer before the function is cut off; call again for what's left.
const BUDGET_MS = 45_000;
const LEAD_ID_KEY = "leadgen_id";

/**
 * POST /api/admin/meta-lead-ads — fill blank campaign and ad columns on instant
 * form leads from Meta's own record of them. Only blanks are written, so it's safe
 * to repeat until `remaining` is 0. `?dry=1` reads without writing. Admin only.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const dryRun = new URL(req.url).searchParams.get("dry") === "1";
  const since = new Date(Date.now() - WINDOW_MS);
  const leads = await prisma.$queryRaw<any[]>`
    SELECT id, "campaignName", "utmCampaign", "adsetId", "creativeId", "rawFormData"
    FROM "Lead"
    WHERE "trashedAt" IS NULL
      AND "receivedAt" >= ${since}
      AND jsonb_exists("rawFormData", ${LEAD_ID_KEY})
      AND (COALESCE("creativeId", '') = '' OR COALESCE("campaignName", '') = '')
    ORDER BY "receivedAt" DESC`;

  const deadline = Date.now() + BUDGET_MS;
  const campaigns: Record<string, number> = {};
  const errors = new Set<string>();
  let processed = 0;
  let filled = 0;
  for (const lead of leads) {
    if (Date.now() > deadline) break;
    processed++;
    const { fill, error } = await fillLeadAd(lead, { dryRun }).catch((e) => ({ fill: {} as Record<string, string>, error: (e as Error).message }));
    if (error) errors.add(error.slice(0, 160));
    if (Object.keys(fill).length === 0) continue;
    filled++;
    const name = fill.campaignName ?? lead.campaignName ?? "campaign name not returned";
    campaigns[name] = (campaigns[name] ?? 0) + 1;
  }

  return NextResponse.json({ dryRun, found: leads.length, processed, filled, remaining: leads.length - processed, campaigns, errors: [...errors] });
}
