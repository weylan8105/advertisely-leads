import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { buildBusinessPnl, type BizRange } from "@/lib/businessPnl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/business-pnl?range=mtd|7d|30d — Advertisely business P&L (admin only). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const r = (new URL(req.url).searchParams.get("range") ?? "mtd") as BizRange;
  const range: BizRange = r === "7d" || r === "30d" ? r : "mtd";
  const pnl = await buildBusinessPnl(range);
  if (!pnl) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  return NextResponse.json(pnl);
}
