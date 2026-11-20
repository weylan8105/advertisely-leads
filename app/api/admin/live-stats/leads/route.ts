import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { parseClientCustom, parseClientRange, rangeWindow } from "@/lib/liveStats";
import { DRILL_LIMIT, metricLeads, parseDrillMetric } from "@/lib/clientPerformanceLeads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/live-stats/leads?metric=contacts|appointments|presentations|apps|policies|leads
 *   &range=…[&from&to][&userId=…]
 * Admin only (Client Performance). The leads behind one number: every agent's,
 * or one agent's when userId is given. Up to 500 leads; `total` is the full count.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const q = req.nextUrl.searchParams;
  const metric = parseDrillMetric(q.get("metric"));
  if (!metric) return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
  let range = parseClientRange(q.get("range"));
  const custom = range === "custom" ? parseClientCustom(q.get("from"), q.get("to")) : null;
  if (range === "custom" && !custom) range = "30d";
  const { since, until } = rangeWindow(range, new Date(), custom);
  const { leads, total } = await metricLeads(since, until, metric, q.get("userId") || null);
  return NextResponse.json({ metric, total, limit: DRILL_LIMIT, leads });
}
