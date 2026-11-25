import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getScorecardSpend } from "@/lib/metaInsights";
import { SPLIT_TESTS, SPLIT_TEST_CAMPAIGN_IDS, scoreSplitTest, type SplitLead, type SplitMove } from "@/lib/splitTest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "America/Chicago";

function ymdInTz(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * GET /api/admin/split-test — the open vs filtered split test (lib/splitTest.ts),
 * one row per arm: Meta spend next to what the leads turned into (qualified,
 * contacted, appointments, applications, sales). Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const since = SPLIT_TESTS.reduce((m, t) => (t.since < m ? t.since : m), SPLIT_TESTS[0].since);
  const until = ymdInTz(new Date());

  const [meta, leads] = await Promise.all([
    getScorecardSpend(since, until),
    prisma.$queryRaw<SplitLead[]>`
      SELECT * FROM (
        SELECT id, "rawFormData", "pipelineStage", "soldAt", "soldPremiumCents",
               ("trashedAt" IS NOT NULL) AS trashed,
               COALESCE(
                 CASE WHEN "utmCampaign" ~ '^[0-9]{10,}$' THEN "utmCampaign" END,
                 CASE WHEN "rawFormData"->>'utm_campaign' ~ '^[0-9]{10,}$' THEN "rawFormData"->>'utm_campaign' END,
                 substring("rawFormData"::text from 'campaignId[^0-9]{1,12}([0-9]{10,})')
               ) AS "campaignId"
        FROM "Lead"
        -- receivedAt is stored as UTC without a zone: tag it UTC first, then convert.
        WHERE (("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date >= ${since}::date
      ) l
      WHERE l."campaignId" = ANY(${SPLIT_TEST_CAMPAIGN_IDS})`,
  ]);

  const moves: SplitMove[] = leads.length
    ? await prisma.leadActivity.findMany({
        where: { leadId: { in: leads.map((l) => l.id) }, type: "STATUS_CHANGED" },
        select: { leadId: true, body: true, metadata: true },
      })
    : [];

  const spendByCampaign = new Map<string, number>();
  for (const ad of meta.ads) {
    if (!ad.campaignId) continue;
    spendByCampaign.set(ad.campaignId, (spendByCampaign.get(ad.campaignId) ?? 0) + ad.spendCents);
  }

  return NextResponse.json({
    configured: meta.configured,
    errors: meta.errors,
    until,
    tests: SPLIT_TESTS.map((t) => ({
      key: t.key,
      label: t.label,
      account: t.account,
      since: t.since,
      studyEnds: t.studyEnds,
      arms: scoreSplitTest(t, leads, moves, spendByCampaign),
    })),
  });
}
