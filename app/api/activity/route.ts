import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { activityByUser, emptyStats, parsePeriod, periodStart } from "@/lib/activityStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/activity?period=today|wtd|mtd|ytd|all — the signed-in agent's
 * Activity Dashboard numbers (leads, dials, contacts, appointments,
 * presentations, policies, AP). See lib/activityStats.ts for definitions.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const period = parsePeriod(new URL(req.url).searchParams.get("period"));
  const since = await periodStart(period);
  const stats = (await activityByUser(since, [userId])).get(userId) ?? emptyStats();
  return NextResponse.json({ period, since, stats });
}
