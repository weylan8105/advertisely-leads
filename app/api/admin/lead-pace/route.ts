import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { getLeadPace } from "@/lib/leadPace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/admin/lead-pace
 * Leads delivered per client per day against the target, and the ad spend that
 * closes the gap (lib/leadPaceMath.ts). Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  return NextResponse.json(await getLeadPace());
}
