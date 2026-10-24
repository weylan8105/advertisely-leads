import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getAbcaAdCosts } from "@/lib/metaInsights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The ABCA ad account reports in US Central time, so days are cut the same way here.
const TZ = "America/Chicago";
const ALLOWED_DAYS = new Set([1, 3, 7, 14, 30]);

function ymdInTz(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * GET /api/admin/ad-costs?days=7 — REAL cost per lead by ad for the ABCA funnel:
 * Meta spend ÷ leads that actually reached our database (quiz leads carry the
 * ad id in utm_content), next to Meta's own lead count for comparison.
 * days=1 means today so far. Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const n = parseInt(new URL(req.url).searchParams.get("days") ?? "7", 10);
  const days = ALLOWED_DAYS.has(n) ? n : 7;
  const until = ymdInTz(new Date());
  const since = ymdInTz(new Date(Date.now() - (days - 1) * 86_400_000));

  const meta = await getAbcaAdCosts(since, until);

  // Real leads per ad id over the same Central-time days.
  const real = await prisma.$queryRaw<{ ad: string | null; n: number }[]>`
    SELECT "rawFormData"->>'utm_content' AS ad, COUNT(*)::int AS n
    FROM "Lead"
    WHERE source = 'early-retirement-quiz'
      -- receivedAt is stored as UTC without a zone: tag it UTC first, then convert.
      AND (("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date BETWEEN ${since}::date AND ${until}::date
    GROUP BY 1`;
  const realByAd = new Map(real.map((r) => [r.ad ?? "", r.n]));

  const rows = meta.rows
    .map((r) => {
      const realLeads = realByAd.get(r.adId) ?? 0;
      realByAd.delete(r.adId);
      return {
        ...r,
        realLeads,
        realCplCents: realLeads > 0 ? Math.round(r.spendCents / realLeads) : null,
        metaCplCents: r.metaLeads > 0 ? Math.round(r.spendCents / r.metaLeads) : null,
        // Share of landing-page visitors who became a real lead.
        realConversionPct: r.landingPageViews > 0 ? Math.round((realLeads / r.landingPageViews) * 1000) / 10 : null,
      };
    })
    .filter((r) => r.spendCents > 0 || r.realLeads > 0)
    .sort((a, b) => b.spendCents - a.spendCents);

  // Leads we got whose ad didn't spend in this window (or had no ad id).
  const unmatchedLeads = [...realByAd.values()].reduce((s, v) => s + v, 0);
  const totals = rows.reduce(
    (t, r) => ({ spendCents: t.spendCents + r.spendCents, metaLeads: t.metaLeads + r.metaLeads, realLeads: t.realLeads + r.realLeads }),
    { spendCents: 0, metaLeads: 0, realLeads: 0 },
  );

  return NextResponse.json({
    configured: meta.configured,
    error: meta.error ?? null,
    days,
    since,
    until,
    rows,
    totals: {
      ...totals,
      realCplCents: totals.realLeads > 0 ? Math.round(totals.spendCents / totals.realLeads) : null,
      metaCplCents: totals.metaLeads > 0 ? Math.round(totals.spendCents / totals.metaLeads) : null,
    },
    unmatchedLeads,
  });
}
