import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getAbcaAdInsights } from "@/lib/metaInsights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quiz step labels (1-based), matching public/abca-quiz.html STEPS order:
// iul_interest -> coverage -> beneficiary -> age -> contact.
const STEP_LABELS = ["What matters most", "Coverage wanted", "Beneficiary", "Age", "Contact"];

const DAY = 86_400_000;
const dayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const parseYmd = (s: string | null): Date | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};

/** Resolve a range preset (or explicit from/to) into UTC [from, to) bounds. */
function resolveRange(range: string, fromParam: string | null, toParam: string | null) {
  const now = new Date();
  const todayStart = dayStart(now);

  const cFrom = parseYmd(fromParam);
  const cTo = parseYmd(toParam);
  if (cFrom && cTo) {
    // Inclusive of the 'to' day.
    return { from: cFrom, to: new Date(cTo.getTime() + DAY), range: "custom" };
  }

  switch (range) {
    case "today":
      return { from: todayStart, to: now, range };
    case "yesterday":
      return { from: new Date(todayStart.getTime() - DAY), to: todayStart, range };
    case "14d":
      return { from: new Date(now.getTime() - 14 * DAY), to: now, range };
    case "30d":
      return { from: new Date(now.getTime() - 30 * DAY), to: now, range };
    case "90d":
      return { from: new Date(now.getTime() - 90 * DAY), to: now, range };
    case "this_month":
      return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now, range };
    case "last_month":
      return {
        from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        range,
      };
    case "max":
      return { from: new Date(0), to: now, range };
    case "7d":
    default:
      return { from: new Date(now.getTime() - 7 * DAY), to: now, range: "7d" };
  }
}

/**
 * GET /api/admin/funnel?range=today|yesterday|7d|14d|30d|90d|this_month|last_month|max
 *   or ?from=YYYY-MM-DD&to=YYYY-MM-DD (custom range)
 * Landing-page funnel analytics for the ABCA quiz. Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ views: 0, completes: 0, steps: [], series: [] });
  }

  const params = new URL(req.url).searchParams;
  const source = params.get("source") ?? "abca-quiz";
  const { from, to, range } = resolveRange(
    params.get("range") ?? "7d",
    params.get("from"),
    params.get("to"),
  );

  const [viewsRows, stepRows, completeRows, adViewsRows, adCompletesRows, seriesRows] = await Promise.all([
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'view' AND "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}`,
    prisma.$queryRaw<{ step: number; c: number }[]>`
      SELECT "step", COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'step' AND "step" IS NOT NULL AND "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY "step" ORDER BY "step"`,
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'complete' AND "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}`,
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'view' AND "source" = ${source} AND "fbclid" IS NOT NULL AND "fbclid" <> ''
        AND "createdAt" >= ${from} AND "createdAt" < ${to}`,
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'complete' AND "source" = ${source} AND "fbclid" IS NOT NULL AND "fbclid" <> ''
        AND "createdAt" >= ${from} AND "createdAt" < ${to}`,
    // Daily trend: distinct sessions per day for views / completes / ad views.
    prisma.$queryRaw<{ day: Date; views: number; completes: number; adviews: number }[]>`
      SELECT date_trunc('day', "createdAt") AS day,
        COUNT(DISTINCT CASE WHEN type='view' THEN "sessionId" END)::int AS views,
        COUNT(DISTINCT CASE WHEN type='complete' THEN "sessionId" END)::int AS completes,
        COUNT(DISTINCT CASE WHEN type='view' AND "fbclid" IS NOT NULL AND "fbclid" <> '' THEN "sessionId" END)::int AS adviews
      FROM "FunnelEvent"
      WHERE "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY day ORDER BY day`,
  ]);

  const views = viewsRows[0]?.c ?? 0;
  const completes = completeRows[0]?.c ?? 0;
  const adViews = adViewsRows[0]?.c ?? 0;
  const adCompletes = adCompletesRows[0]?.c ?? 0;
  const byStep = new Map(stepRows.map((r) => [Number(r.step), Number(r.c)]));

  // Render every step that actually has data, not just the ones we have labels
  // for — the live quiz can have more steps than STEP_LABELS (it currently runs
  // past step 5). Unlabeled steps fall back to "Step N" so none are dropped.
  const maxStepInData = stepRows.reduce((m, r) => Math.max(m, Number(r.step) || 0), 0);
  const maxStep = Math.max(STEP_LABELS.length, maxStepInData);

  // The funnel now starts at the LANDING PAGE (page views = 100% baseline), so
  // the big pre-quiz drop — visitors who hit the ZIP/landing page but never start
  // the quiz — is visible instead of hidden. "What matters most" (quiz step 1) is
  // only reached after the ZIP gate, so it is no longer treated as 100%.
  const rawSteps: { label: string; count: number }[] = [
    { label: "Visited page (ZIP)", count: views },
  ];
  for (let n = 1; n <= maxStep; n++) {
    rawSteps.push({ label: STEP_LABELS[n - 1] ?? `Step ${n}`, count: byStep.get(n) ?? 0 });
  }
  const steps = [];
  let biggestDrop = { step: 0, label: "", dropPct: 0, lost: 0 };
  for (let i = 0; i < rawSteps.length; i++) {
    const count = rawSteps[i].count;
    const prevCount = i === 0 ? count : rawSteps[i - 1].count;
    const stepConversion = prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
    const dropPct = i === 0 ? 0 : 100 - stepConversion;
    const lost = Math.max(0, prevCount - count);
    const step = i + 1; // 1-based display position (step 1 = landing page)
    if (i > 0 && dropPct >= biggestDrop.dropPct) {
      biggestDrop = { step, label: rawSteps[i].label, dropPct, lost };
    }
    steps.push({ step, label: rawSteps[i].label, count, stepConversion, dropPct, lost });
  }

  const series = seriesRows.map((r) => ({
    date: new Date(r.day).toISOString().slice(0, 10),
    views: Number(r.views),
    completes: Number(r.completes),
    adViews: Number(r.adviews),
  }));

  const nonAdViews = Math.max(0, views - adViews);
  const nonAdCompletes = Math.max(0, completes - adCompletes);

  // TRUE ad conversion: ad-attributed leads ÷ Facebook-reported clicks / landing
  // page views for the ABCA funnel account. Reads lower than leads ÷ tracked page
  // views because Facebook counts clicks our on-page beacon never sees. Inert
  // (adFunnelConfigured:false, no Graph call) until ABCA_AD_ACCOUNT_ID is set.
  const sinceYmd = from.toISOString().slice(0, 10);
  const untilYmd = new Date(Math.max(from.getTime(), to.getTime() - 1)).toISOString().slice(0, 10);
  const adFunnel = await getAbcaAdInsights(sinceYmd, untilYmd);
  const adClickDenom = adFunnel.landingPageViews || adFunnel.linkClicks || 0;
  const trueAdConversionRate =
    adFunnel.configured && adClickDenom > 0
      ? Math.round((adCompletes / adClickDenom) * 1000) / 10
      : null;

  return NextResponse.json({
    range,
    from: from.toISOString(),
    to: to.toISOString(),
    views,
    completes,
    completionRate: views > 0 ? Math.round((completes / views) * 100) : 0,
    adViews,
    adCompletes,
    adCompletionRate: adViews > 0 ? Math.round((adCompletes / adViews) * 100) : 0,
    adSharePct: views > 0 ? Math.round((adViews / views) * 100) : 0,
    nonAdViews,
    nonAdCompletes,
    nonAdCompletionRate: nonAdViews > 0 ? Math.round((nonAdCompletes / nonAdViews) * 100) : 0,
    steps,
    biggestDrop: biggestDrop.step > 0 ? biggestDrop : null,
    series,
    // True ad conversion (leads ÷ real Facebook clicks for the ABCA funnel).
    adFunnelConfigured: adFunnel.configured,
    adLinkClicks: adFunnel.linkClicks,
    adLandingViews: adFunnel.landingPageViews,
    trueAdConversionRate,
    adFunnelError: adFunnel.error ?? null,
  });
}
