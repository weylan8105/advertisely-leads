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

// Meta Audience Network (third-party app) clicks carry this app_id inside the
// fbclid payload. They're overwhelmingly accidental taps (~24% CTR, ~1% start
// the quiz), and they arrive in bursts that swamp a day's numbers — so the
// headline funnel excludes them and reports them as their own segment.
const AUDIENCE_NETWORK_APP_ID = "245790818955868";
function isAudienceNetworkClick(fbclid: string | null): boolean {
  if (!fbclid || fbclid.length < 8) return false;
  try {
    const decoded = Buffer.from(fbclid.slice(2), "base64url").toString("latin1");
    const m = decoded.match(/app_id.(\d+)/);
    return !!m && m[1] === AUDIENCE_NETWORK_APP_ID;
  } catch {
    return false;
  }
}

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

  // One row per page-load session; rolled up per PERSON below. The page mints a
  // new sessionId on every load, so reloads / back-navigation / re-opening the
  // ad would otherwise count one visitor several times (~11% inflation).
  const [sessionRows, zipErrRows] = await Promise.all([
    prisma.$queryRaw<{ sessionId: string; fbclid: string | null; t: Date; v: boolean; c: boolean; steps: number[] | null; cta1: string | null }[]>`
      SELECT "sessionId",
        MAX("fbclid") AS fbclid,
        MIN("createdAt") AS t,
        BOOL_OR(type = 'view') AS v,
        BOOL_OR(type = 'complete') AS c,
        ARRAY_AGG(DISTINCT "step") FILTER (WHERE type = 'step' AND "step" IS NOT NULL) AS steps,
        -- entry point (cta slug) of this session's first quiz start
        (ARRAY_AGG("cta" ORDER BY "createdAt") FILTER (WHERE type = 'step' AND "step" = 1))[1] AS cta1
      FROM "FunnelEvent"
      WHERE "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}
        AND type IN ('view', 'step', 'complete')
      GROUP BY "sessionId"`,
    // Taps on the ZIP button without a valid ZIP (step = digits typed, 0-4).
    prisma.$queryRaw<{ digits: number | null; c: number }[]>`
      SELECT "step" AS digits, COUNT(*)::int AS c FROM "FunnelEvent"
      WHERE type = 'zip_error' AND "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY "step"`,
  ]);

  // Person = fbclid when it's a real Meta click id (one per ad click), else the
  // session itself. Real fbclids are 60-200+ chars; short values are placeholders
  // or test links (e.g. a literal "?fbclid=fbclid") that would otherwise merge
  // many different visitors into one "person".
  type Person = {
    completed: boolean; steps: Set<number>; ad: boolean; an: boolean; day: string;
    startT: number | null; startCta: string | null;
  };
  const people = new Map<string, Person>();
  const viewKeys = new Set<string>();
  let viewSessions = 0;
  for (const s of sessionRows) {
    const fb = s.fbclid && s.fbclid.length >= 20 ? s.fbclid : null;
    const key = fb ? `f:${fb}` : `s:${s.sessionId}`;
    const t = new Date(s.t).getTime();
    const day = new Date(s.t).toISOString().slice(0, 10);
    let p = people.get(key);
    if (!p) {
      p = { completed: false, steps: new Set<number>(), ad: !!fb, an: isAudienceNetworkClick(fb), day, startT: null, startCta: null };
      people.set(key, p);
    } else if (day < p.day) {
      p.day = day;
    }
    if (s.v) {
      viewSessions++;
      viewKeys.add(key);
    }
    if (s.c) p.completed = true;
    const st = s.steps ?? [];
    for (const n of st) p.steps.add(Number(n));
    // Entry point = the one used for this person's FIRST quiz start.
    if (st.some((n) => Number(n) === 1) && (p.startT === null || t < p.startT)) {
      p.startT = t;
      p.startCta = s.cta1 ?? null;
    }
  }
  const everyone = [...people.values()];
  // Headline funnel = real people, Audience Network excluded.
  const humans = everyone.filter((p) => !p.an);
  const anPeople = everyone.filter((p) => p.an);

  const views = humans.length;
  const completes = humans.filter((p) => p.completed).length;
  const adHumans = humans.filter((p) => p.ad);
  const adViews = adHumans.length;
  const adCompletes = adHumans.filter((p) => p.completed).length;
  const byStep = new Map<number, number>();
  for (const p of humans) for (const n of p.steps) byStep.set(n, (byStep.get(n) ?? 0) + 1);

  const anVisitors = anPeople.length;
  const anStarted = anPeople.filter((p) => p.steps.has(1)).length;
  const anCompletes = anPeople.filter((p) => p.completed).length;
  const duplicateLoads = Math.max(0, viewSessions - viewKeys.size);

  // Render every step that actually has data, not just the ones we have labels
  // for — the live quiz can have more steps than STEP_LABELS (it currently runs
  // past step 5). Unlabeled steps fall back to "Step N" so none are dropped.
  const maxStepInData = Math.max(0, ...byStep.keys());
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

  // Daily trend (UTC day each person first arrived): real people, plus the
  // excluded Audience Network count so a burst is visible but not mixed in.
  const dayMap = new Map<string, { views: number; completes: number; adViews: number; anViews: number }>();
  for (const p of everyone) {
    const d = dayMap.get(p.day) ?? { views: 0, completes: 0, adViews: 0, anViews: 0 };
    if (p.an) {
      d.anViews++;
    } else {
      d.views++;
      if (p.completed) d.completes++;
      if (p.ad) d.adViews++;
    }
    dayMap.set(p.day, d);
  }
  const series = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => ({ date, ...d }));

  // Per person, Audience Network excluded — reconciles with the step-1 funnel bar.
  const entryCounts = new Map<string, number>();
  for (const p of humans) {
    if (p.startT === null) continue;
    const k = p.startCta ?? "untracked";
    entryCounts.set(k, (entryCounts.get(k) ?? 0) + 1);
  }
  const entryPoints = [...entryCounts.entries()]
    .map(([cta, count]) => ({ cta, count }))
    .sort((a, b) => b.count - a.count);
  const zipErrors = { empty: 0, partial: 0 };
  for (const r of zipErrRows) {
    if ((r.digits ?? 0) === 0) zipErrors.empty += Number(r.c);
    else zipErrors.partial += Number(r.c);
  }

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
  // Meta's click counts include Audience Network for any period it was on, so
  // the numerator includes AN leads too (like-for-like with Meta's denominator).
  const adCompletesAll = adCompletes + anCompletes;
  const trueAdConversionRate =
    adFunnel.configured && adClickDenom > 0
      ? Math.round((adCompletesAll / adClickDenom) * 1000) / 10
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
    // Excluded from the headline funnel, reported separately.
    anVisitors,
    anStarted,
    anCompletes,
    duplicateLoads,
    viewSessions,
    // How visitors entered the quiz, and taps on the ZIP button with no/partial ZIP.
    entryPoints,
    zipErrors,
    adCompletesAll,
    // True ad conversion (leads ÷ real Facebook clicks for the ABCA funnel).
    adFunnelConfigured: adFunnel.configured,
    adLinkClicks: adFunnel.linkClicks,
    adLandingViews: adFunnel.landingPageViews,
    trueAdConversionRate,
    adFunnelError: adFunnel.error ?? null,
  });
}
