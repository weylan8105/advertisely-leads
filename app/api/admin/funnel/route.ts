import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Quiz step labels (1-based), matching public/abca-quiz.html STEPS order.
const STEP_LABELS = ["Trade", "IUL Interest", "Age", "State", "Income", "Budget", "Contact"];

/**
 * GET /api/admin/funnel?range=today|7d|30d
 * Landing-page funnel: page views, how far visitors get (per step), completions.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ views: 0, completes: 0, steps: [] });
  }

  const params = new URL(req.url).searchParams;
  const range = params.get("range") ?? "7d";
  const source = params.get("source") ?? "abca-quiz";
  const now = new Date();
  let from: Date;
  if (range === "today") {
    from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else if (range === "30d") {
    from = new Date(Date.now() - 30 * 86_400_000);
  } else {
    from = new Date(Date.now() - 7 * 86_400_000);
  }

  const [viewsRows, stepRows, completeRows] = await Promise.all([
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'view' AND "source" = ${source} AND "createdAt" >= ${from}`,
    prisma.$queryRaw<{ step: number; c: number }[]>`
      SELECT "step", COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'step' AND "step" IS NOT NULL AND "source" = ${source} AND "createdAt" >= ${from}
      GROUP BY "step" ORDER BY "step"`,
    prisma.$queryRaw<{ c: number }[]>`
      SELECT COUNT(DISTINCT "sessionId")::int AS c FROM "FunnelEvent"
      WHERE type = 'complete' AND "source" = ${source} AND "createdAt" >= ${from}`,
  ]);

  const views = viewsRows[0]?.c ?? 0;
  const completes = completeRows[0]?.c ?? 0;
  const byStep = new Map(stepRows.map((r) => [Number(r.step), Number(r.c)]));

  // Each session fires a "step" event for every step it renders, so the distinct
  // count per step IS the cumulative "reached step N" (monotonic).
  const maxStep = Math.max(STEP_LABELS.length, ...stepRows.map((r) => Number(r.step)));
  const steps = [];
  for (let n = 1; n <= maxStep; n++) {
    const count = byStep.get(n) ?? 0;
    const prev = n === 1 ? views || count : (byStep.get(n - 1) ?? 0);
    steps.push({
      step: n,
      label: STEP_LABELS[n - 1] ?? `Step ${n}`,
      count,
      // % of the previous step that continued to this one
      stepConversion: prev > 0 ? Math.round((count / prev) * 100) : 0,
    });
  }

  return NextResponse.json({
    range,
    from: from.toISOString(),
    views,
    completes,
    completionRate: views > 0 ? Math.round((completes / views) * 100) : 0,
    steps,
  });
}
