import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { parsePerfRange } from "@/lib/adPerformance";
import { parsePerfDrillMetric, perfLeads } from "@/lib/adPerformanceLeads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/performance/leads?metric=leads|dialed|contacted|applications|issuedPaid
 *   &scope=all|ew|abca|ewws|campaign:<id>|none&range=…[&from&to]
 * Admin only. The leads behind one Ad Performance number (newest 500; `total` is the full count).
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const q = req.nextUrl.searchParams;
  const metric = parsePerfDrillMetric(q.get("metric"));
  if (!metric) return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
  const scope = q.get("scope") || "all";
  if (!/^(all|ew|abca|ewws|none|campaign:\d+)$/.test(scope)) return NextResponse.json({ error: "Unknown scope" }, { status: 400 });
  const out = await perfLeads(parsePerfRange(q.get("range")), q.get("from"), q.get("to"), metric, scope);
  return NextResponse.json({ metric, ...out });
}
