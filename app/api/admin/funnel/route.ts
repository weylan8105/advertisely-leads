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
// Version B (tap-first hero A/B arm): the hero tap answers step 1, then ZIP, then the rest.
const STEP_LABELS_B = ["Who are you protecting? (tap)", "ZIP code", "What matters most", "Coverage wanted", "Age", "Contact"];

// A/B test planned sample per arm (two-sided alpha 0.05, 80% power):
//  - first answer 20% -> 26%:           ~775 visitors per version
//  - leads per visitor 7% -> ~9% (+30%): ~2,700 visitors per version
const AB_PLANNED_START = 775;
const AB_PLANNED_LEADS = 2700;

// Two-sided p-value for a difference between two proportions (pooled z-test).
function erf(x: number): number {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
function twoPropP(x1: number, n1: number, x2: number, n2: number): number | null {
  if (n1 < 1 || n2 < 1) return null;
  const pool = (x1 + x2) / (n1 + n2);
  const se = Math.sqrt(pool * (1 - pool) * (1 / n1 + 1 / n2));
  if (!se) return null;
  const z = (x2 / n2 - x1 / n1) / se;
  return Math.round((1 - erf(Math.abs(z) / Math.SQRT2)) * 1000) / 1000;
}

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
  type SessionRow = { sessionId: string; fbclid: string | null; variant: string | null; t: Date; v: boolean; c: boolean; steps: number[] | null; cta1: string | null };
  const [sessionRows, zipErrRows, testRows] = await Promise.all([
    prisma.$queryRaw<SessionRow[]>`
      SELECT "sessionId",
        MAX("fbclid") AS fbclid,
        MAX("variant") AS variant,
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
    // Taps on a ZIP button/Continue without a valid ZIP (step = digits typed, 0-4), per version.
    prisma.$queryRaw<{ digits: number | null; variant: string | null; c: number }[]>`
      SELECT "step" AS digits, "variant", COUNT(*)::int AS c FROM "FunnelEvent"
      WHERE type = 'zip_error' AND "source" = ${source} AND "createdAt" >= ${from} AND "createdAt" < ${to}
      GROUP BY "step", "variant"`,
    // A/B test: EVERY session tagged with a version, regardless of the date picker — the
    // comparison always covers the whole test (the page only tags visitors while it runs,
    // and never tags forced ?abv= QA visits).
    prisma.$queryRaw<SessionRow[]>`
      SELECT "sessionId",
        MAX("fbclid") AS fbclid,
        MAX("variant") AS variant,
        MIN("createdAt") AS t,
        BOOL_OR(type = 'view') AS v,
        BOOL_OR(type = 'complete') AS c,
        ARRAY_AGG(DISTINCT "step") FILTER (WHERE type = 'step' AND "step" IS NOT NULL) AS steps,
        (ARRAY_AGG("cta" ORDER BY "createdAt") FILTER (WHERE type = 'step' AND "step" = 1))[1] AS cta1
      FROM "FunnelEvent"
      WHERE "source" = ${source} AND type IN ('view', 'step', 'complete')
      GROUP BY "sessionId"
      HAVING MAX("variant") IS NOT NULL`,
  ]);

  // Person = fbclid when it's a real Meta click id (one per ad click), else the
  // session itself. Real fbclids are 60-200+ chars; short values are placeholders
  // or test links (e.g. a literal "?fbclid=fbclid") that would otherwise merge
  // many different visitors into one "person".
  type Person = {
    completed: boolean; steps: Set<number>; ad: boolean; an: boolean; day: string;
    startT: number | null; startCta: string | null;
    variant: "A" | "B" | null; // A/B arm; null = before the test (saw the ZIP-first page)
  };
  function rollup(rows: SessionRow[]) {
  const people = new Map<string, Person>();
  const viewKeys = new Set<string>();
  let viewSessions = 0;
  for (const s of rows) {
    const fb = s.fbclid && s.fbclid.length >= 20 ? s.fbclid : null;
    const key = fb ? `f:${fb}` : `s:${s.sessionId}`;
    const t = new Date(s.t).getTime();
    const day = new Date(s.t).toISOString().slice(0, 10);
    let p = people.get(key);
    if (!p) {
      p = { completed: false, steps: new Set<number>(), ad: !!fb, an: isAudienceNetworkClick(fb), day, startT: null, startCta: null, variant: null };
      people.set(key, p);
    } else if (day < p.day) {
      p.day = day;
    }
    if (!p.variant && (s.variant === "A" || s.variant === "B")) p.variant = s.variant;
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
  return { people: [...people.values()], viewSessions, duplicateLoads: Math.max(0, viewSessions - viewKeys.size) };
  }
  const main = rollup(sessionRows);
  const everyone = main.people;
  const viewSessions = main.viewSessions;
  // Headline funnel = real people, Audience Network excluded.
  const humans = everyone.filter((p) => !p.an);
  const anPeople = everyone.filter((p) => p.an);

  // A/B test scoping: ?variant=A | B narrows everything below to that version. While B
  // traffic is in range, "A" means tagged A only (same period as B); otherwise untagged
  // (pre-test) visitors saw the ZIP-first page, so they count as A.
  const variantParam = params.get("variant");
  const variantFilter = variantParam === "A" || variantParam === "B" ? variantParam : null;
  const isB = (p: Person) => p.variant === "B";
  const abActive = humans.some(isB);
  const scoped = variantFilter === "B"
    ? humans.filter(isB)
    : variantFilter === "A"
      ? humans.filter((p) => (abActive ? p.variant === "A" : !isB(p)))
      : humans;
  const scopedSet = new Set(scoped);
  // Shared milestones (B asks ZIP on its own step 2, A on the hero):
  //  - Entered ZIP: B = got past its ZIP screen (step 3). A = started from a ZIP form
  //    (header/sticky starts give no ZIP until the contact form), or completed (contact
  //    requires a ZIP). Starts from before entry points were tracked default to ZIP.
  //  - Reached contact form: B step 6, A step 5 (or completed).
  const zipDone = (p: Person) =>
    isB(p) ? p.steps.has(3) || p.completed : p.completed || (p.steps.has(1) && /zip/.test(p.startCta ?? "zip"));
  const contactDone = (p: Person) => p.completed || p.steps.has(isB(p) ? 6 : 5);

  const views = scoped.length;
  const completes = scoped.filter((p) => p.completed).length;
  const adHumans = scoped.filter((p) => p.ad);
  const adViews = adHumans.length;
  const adCompletes = adHumans.filter((p) => p.completed).length;
  const byStep = new Map<number, number>();
  for (const p of scoped) for (const n of p.steps) byStep.set(n, (byStep.get(n) ?? 0) + 1);

  const anVisitors = anPeople.length;
  const anStarted = anPeople.filter((p) => p.steps.has(1)).length;
  const anCompletes = anPeople.filter((p) => p.completed).length;
  const duplicateLoads = main.duplicateLoads;

  // The funnel starts at the LANDING PAGE (visitors = 100% baseline), so the big
  // pre-quiz drop is visible. With one version in view (or no B traffic) the bars
  // are per question; with both versions mixed they're shared milestones, since
  // the two versions ask their questions in a different order.
  const stepMode: "questions" | "milestones" = !variantFilter && abActive ? "milestones" : "questions";
  const rawSteps: { label: string; count: number }[] = [];
  if (stepMode === "milestones") {
    rawSteps.push(
      { label: "Visited page", count: views },
      { label: "Started (first answer)", count: scoped.filter((p) => p.steps.has(1)).length },
      { label: "Entered ZIP", count: scoped.filter(zipDone).length },
      { label: "Reached contact form", count: scoped.filter(contactDone).length },
    );
  } else {
    // Every step that actually has data, not just labelled ones ("Step N" fallback).
    const labels = variantFilter === "B" ? STEP_LABELS_B : STEP_LABELS;
    const maxStep = Math.max(labels.length, Math.max(0, ...byStep.keys()));
    rawSteps.push({ label: variantFilter === "B" ? "Visited page" : "Visited page (ZIP)", count: views });
    for (let n = 1; n <= maxStep; n++) {
      rawSteps.push({ label: labels[n - 1] ?? `Step ${n}`, count: byStep.get(n) ?? 0 });
    }
  }

  // A/B comparison — the WHOLE test window (not the date picker), randomized ad visitors
  // only (fbclid; direct/testing traffic excluded), Audience Network excluded.
  type Arm = {
    visitors: number; started: number; zipEntered: number; reachedContact: number; leads: number;
    startRate: number; zipRate: number; contactRate: number; leadRate: number;
  };
  const testPeople = rollup(testRows).people.filter((p) => !p.an && p.ad && (p.variant === "A" || p.variant === "B"));
  const armStats = (v: "A" | "B"): Arm => {
    const ps = testPeople.filter((p) => p.variant === v);
    const n = ps.length;
    const started = ps.filter((p) => p.steps.has(1)).length;
    const zipEntered = ps.filter(zipDone).length;
    const reachedContact = ps.filter(contactDone).length;
    const leads = ps.filter((p) => p.completed).length;
    const pct = (x: number) => (n ? Math.round((x / n) * 1000) / 10 : 0);
    return {
      visitors: n, started, zipEntered, reachedContact, leads,
      startRate: pct(started), zipRate: pct(zipEntered), contactRate: pct(reachedContact), leadRate: pct(leads),
    };
  };
  // 95% confidence range for B's leads-per-visitor change, relative to A (Wald interval).
  const leadRelCI = (A: Arm, B: Arm): [number, number] | null => {
    if (A.visitors < 30 || B.visitors < 30 || A.leads === 0) return null;
    const pA = A.leads / A.visitors;
    const pB = B.leads / B.visitors;
    const se = Math.sqrt((pA * (1 - pA)) / A.visitors + (pB * (1 - pB)) / B.visitors);
    const d = pB - pA;
    return [Math.round(((d - 1.96 * se) / pA) * 100), Math.round(((d + 1.96 * se) / pA) * 100)];
  };
  const lift = (a: number, b: number) => (a > 0 ? Math.round(((b - a) / a) * 100) : null);
  let abTest: null | {
    A: Arm; B: Arm;
    startP: number | null; contactP: number | null; leadP: number | null;
    startLiftPct: number | null; contactLiftPct: number | null; leadLiftPct: number | null;
    leadCI: [number, number] | null;
    plannedStart: number; plannedLeads: number;
    window: { start: string; end: string };
  } = null;
  if (testPeople.some(isB)) {
    const A = armStats("A");
    const B = armStats("B");
    let tMin = Infinity, tMax = -Infinity;
    for (const r of testRows) { const t = new Date(r.t).getTime(); if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
    abTest = {
      A, B,
      startP: twoPropP(A.started, A.visitors, B.started, B.visitors),
      contactP: twoPropP(A.reachedContact, A.visitors, B.reachedContact, B.visitors),
      leadP: twoPropP(A.leads, A.visitors, B.leads, B.visitors),
      startLiftPct: lift(A.startRate, B.startRate),
      contactLiftPct: lift(A.contactRate, B.contactRate),
      leadLiftPct: lift(A.leadRate, B.leadRate),
      leadCI: leadRelCI(A, B),
      plannedStart: AB_PLANNED_START,
      plannedLeads: AB_PLANNED_LEADS,
      window: { start: new Date(tMin).toISOString(), end: new Date(tMax).toISOString() },
    };
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
    } else if (scopedSet.has(p)) {
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
  for (const p of scoped) {
    if (p.startT === null) continue;
    const k = p.startCta ?? "untracked";
    entryCounts.set(k, (entryCounts.get(k) ?? 0) + 1);
  }
  const entryPoints = [...entryCounts.entries()]
    .map(([cta, count]) => ({ cta, count }))
    .sort((a, b) => b.count - a.count);
  const zipErrors = { empty: 0, partial: 0 };
  for (const r of zipErrRows) {
    // Same version scoping as the funnel (B's in-quiz ZIP errors never land in A's view).
    const keep = !variantFilter || (variantFilter === "B" ? r.variant === "B" : abActive ? r.variant === "A" : r.variant !== "B");
    if (!keep) continue;
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
  // Meta's clicks cover both A/B versions, so a single-version ratio would be ~halved — only
  // report it for the combined view.
  const trueAdConversionRate =
    !variantFilter && adFunnel.configured && adClickDenom > 0
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
    // A/B test: which version is in view, how the step bars are built, and the comparison.
    variant: variantFilter,
    stepMode,
    abTest,
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
