import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { teamDialsReport } from "@/lib/teamDials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team/dials — each member's dials for the teams the caller leads:
 * today so far, and the 9 pm Central daily report (lib/teamDials.ts).
 * { report: null } when the caller doesn't lead a team with members.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  return NextResponse.json({ report: await teamDialsReport(userId) });
}
