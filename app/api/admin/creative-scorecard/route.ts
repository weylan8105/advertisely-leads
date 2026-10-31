import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getScorecardSpend } from "@/lib/metaInsights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ad accounts report in US Central time, so days are cut the same way here.
const TZ = "America/Chicago";
const ALLOWED_DAYS = new Set([7, 30, 90]);
// Stages that count as a submitted application (and beyond) — the same stages
// that report back to Meta (lib/metaCapi.ts STAGE_EVENTS).
const APP_STAGES = ["underwriting", "approved", "issued-not-paid", "issued-paid"];
const PAID_STAGE = "issued-paid";

function ymdInTz(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

type Funnel = "ABCA" | "Enhanced Wealth" | "HWA" | "Other";

function funnelFor(account: string | null, campaignName: string, source: string | null): Funnel {
  if (campaignName.includes("HWA") || source === "healthcare-wealth-quiz") return "HWA";
  if (account === "ABCA" || source === "early-retirement-quiz") return "ABCA";
  if (account === "Enhanced Wealth") return "Enhanced Wealth";
  // Without Meta data: Facebook instant-form leads all come from the Enhanced Wealth account.
  if (!account && source && !source.endsWith("-quiz")) return "Enhanced Wealth";
  return "Other";
}

/**
 * GET /api/admin/creative-scorecard?days=30|7|90|all — one row per ad: Meta
 * spend next to the leads that ad produced in the window and how far those
 * leads have gone in the CRM (applications, Issued PAID, premium). Leads carry
 * their ad id in Lead.creativeId (instant forms) or rawFormData.utm_content
 * (quiz funnels). Older lead-form imports stored only the ad set ("ag:<id>").
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const param = new URL(req.url).searchParams.get("days") ?? "30";
  const n = parseInt(param, 10);
  const days = param === "all" ? null : ALLOWED_DAYS.has(n) ? n : 30;
  const until = ymdInTz(new Date());
  const since = days ? ymdInTz(new Date(Date.now() - (days - 1) * 86_400_000)) : null;

  const [meta, leadRows] = await Promise.all([
    getScorecardSpend(since, until),
    prisma.$queryRaw<
      { ad: string | null; source: string | null; leads: number; apps: number; paid: number; premium: bigint | number }[]
    >`
      SELECT COALESCE("creativeId", NULLIF("rawFormData"->>'utm_content', '')) AS ad,
             MIN(source) AS source,
             COUNT(*)::int AS leads,
             COUNT(*) FILTER (WHERE "pipelineStage" = ANY(${APP_STAGES}))::int AS apps,
             COUNT(*) FILTER (WHERE "pipelineStage" = ${PAID_STAGE})::int AS paid,
             COALESCE(SUM("soldPremiumCents") FILTER (WHERE "pipelineStage" = ${PAID_STAGE}), 0) AS premium
      FROM "Lead"
      -- receivedAt is stored as UTC without a zone: tag it UTC first, then convert.
      WHERE (${since}::date IS NULL OR (("receivedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${TZ})::date >= ${since}::date)
      GROUP BY 1`,
  ]);

  const adById = new Map(meta.ads.map((a) => [a.adId, a]));
  const byAd = new Map<string, { source: string | null; leads: number; apps: number; paid: number; premiumCents: number }>();
  let noAdLeads = 0;
  for (const r of leadRows) {
    if (!r.ad) {
      noAdLeads += r.leads;
      continue;
    }
    byAd.set(r.ad, { source: r.source, leads: r.leads, apps: r.apps, paid: r.paid, premiumCents: Number(r.premium) });
  }

  const ids = new Set<string>([...byAd.keys(), ...meta.ads.filter((a) => a.spendCents > 0).map((a) => a.adId)]);
  const rows = [...ids].map((id) => {
    const a = adById.get(id);
    const l = byAd.get(id) ?? { source: null, leads: 0, apps: 0, paid: 0, premiumCents: 0 };
    const spendCents = a?.spendCents ?? 0;
    let adName = a?.adName ?? id;
    let detail = a ? [a.campaignName, a.adsetName].filter(Boolean).join(" · ") : "";
    if (!a && id.startsWith("ag:")) {
      const adsetName = meta.adsets[id.slice(3)];
      adName = adsetName ? `${adsetName} (ad set)` : `Ad set ${id.slice(3)}`;
      detail = "Older lead-form leads: only the ad set was recorded";
    } else if (!a) {
      detail = "Ad not found in either ad account";
    }
    return {
      adId: id,
      adName,
      detail,
      status: a?.status ?? null,
      funnel: funnelFor(a?.account ?? null, a?.campaignName ?? "", l.source),
      spendCents,
      leads: l.leads,
      apps: l.apps,
      paid: l.paid,
      premiumCents: l.premiumCents,
      cplCents: spendCents > 0 && l.leads > 0 ? Math.round(spendCents / l.leads) : null,
      costPerPaidCents: spendCents > 0 && l.paid > 0 ? Math.round(spendCents / l.paid) : null,
      appRatePct: l.leads > 0 ? Math.round((l.apps / l.leads) * 1000) / 10 : null,
      // Annual premium written per $1 of ad spend.
      premiumPerDollar: spendCents > 0 ? Math.round((l.premiumCents / spendCents) * 100) / 100 : null,
    };
  });

  return NextResponse.json({
    configured: meta.configured,
    errors: meta.errors,
    days: days ?? "all",
    since,
    until,
    rows,
    noAdLeads,
  });
}
