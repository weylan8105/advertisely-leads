import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { isActive, liveStats, parseClientRange } from "@/lib/liveStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/live-stats?range=today|yesterday|7d|30d|all — admin only
 * (Client Performance page). Totals plus the agents behind them, most submitted
 * AP first. 30d (default) is the same rolling window as the homepage.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const range = parseClientRange(req.nextUrl.searchParams.get("range"));
  const { byUser, ...summary } = await liveStats(range);
  const ids = [...byUser.keys()];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email?.split("@")[0] || "Unknown"]));
  const agents = ids
    .map((id) => ({ id, name: nameOf.get(id) ?? "Unknown", ...byUser.get(id)! }))
    .filter(isActive)
    .sort((a, b) => b.submittedApCents - a.submittedApCents || b.apps - a.apps || b.dials - a.dials);
  return NextResponse.json({ ...summary, agents });
}
