import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { getAdPerformance, parsePerfRange } from "@/lib/adPerformance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/performance?range=today|yesterday|7d|30d|shared — the Ad Performance dashboard's numbers. Admin only. */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const range = parsePerfRange(new URL(req.url).searchParams.get("range"));
  return NextResponse.json(await getAdPerformance(range));
}
