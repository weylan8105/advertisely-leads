import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { liveStats } from "@/lib/liveStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/live-stats — admin only. The homepage's rolling 30-day totals
 * plus the agents behind them (most submitted AP first).
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const { totals, activeAgents, since, generatedAt, byUser } = await liveStats();
  const ids = [...byUser.keys()];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email?.split("@")[0] || "Unknown"]));
  const agents = ids
    .map((id) => ({ id, name: nameOf.get(id) ?? "Unknown", ...byUser.get(id)! }))
    .filter((a) => a.leads + a.dials + a.apps + a.policies > 0)
    .sort((a, b) => b.submittedApCents - a.submittedApCents || b.apps - a.apps || b.dials - a.dials);
  return NextResponse.json({ totals, activeAgents, since, generatedAt, agents });
}
