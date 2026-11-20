import { NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { liveStats } from "@/lib/liveStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/stats/live — public, no sign-in. Rolling 30-day totals for the
 * homepage: leads, dials, contacts, appointments, apps + submitted AP, issued
 * policies + AP. Totals only, never names, leads or contact details.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  try {
    const { totals, activeAgents, since, generatedAt } = await liveStats("30d");
    return NextResponse.json(
      { totals, activeAgents, since, generatedAt },
      { headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" } },
    );
  } catch {
    return NextResponse.json({ error: "Stats unavailable" }, { status: 500 });
  }
}
