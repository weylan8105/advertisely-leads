import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { MAX_RANGE_DAYS, daysBetween, getLeadsByClient, isYmd, todayCentral } from "@/lib/leadsByClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/lead-pace/clients?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Leads each client got in a Central-time date range (inclusive), most first,
 * with a per-day breakdown (lib/leadsByClient.ts). Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const sp = req.nextUrl.searchParams;
  const today = todayCentral();
  const from = sp.get("from") ?? today;
  const to = sp.get("to") ?? today;
  if (!isYmd(from) || !isYmd(to)) return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  if (from > to) return NextResponse.json({ error: "The start date is after the end date" }, { status: 400 });
  if (daysBetween(from, to) > MAX_RANGE_DAYS) return NextResponse.json({ error: `Pick a range under ${MAX_RANGE_DAYS} days` }, { status: 400 });

  return NextResponse.json(await getLeadsByClient(from, to));
}
