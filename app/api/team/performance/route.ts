import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { canManageTeam, ensureOrgContext } from "@/lib/org";
import { activityByUser, addStats, emptyStats } from "@/lib/activityStats";
import { isActive, parseClientCustom, parseClientRange, rangeWindow } from "@/lib/liveStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team/performance?range=today|yesterday|7d|30d|all|custom[&from&to]
 * Team leaders (owner/admin of their current team) only: each member's
 * production for the range, the same numbers as the admin Client Performance
 * page (lib/liveStats.ts) but limited to this team's members. Every member is
 * listed, including ones with nothing in the range. Numbers only, no lead cards.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await ensureOrgContext(userId);
  if (!ctx || !canManageTeam(ctx.role)) return NextResponse.json({ error: "Team leaders only" }, { status: 403 });

  const q = req.nextUrl.searchParams;
  let range = parseClientRange(q.get("range"));
  const custom = range === "custom" ? parseClientCustom(q.get("from"), q.get("to")) : null;
  if (range === "custom" && !custom) range = "30d";
  const now = new Date();
  const { since, until } = rangeWindow(range, now, custom);

  const memberships = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId },
    select: { userId: true, role: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const ids = memberships.map((m) => m.userId);
  const byUser = await activityByUser(since, ids, until);

  let totals = emptyStats();
  let activeAgents = 0;
  const agents = memberships.map((m) => {
    const s = byUser.get(m.userId) ?? emptyStats();
    totals = addStats(totals, s);
    if (isActive(s)) activeAgents++;
    return {
      id: m.userId,
      name: m.user.name?.trim() || m.user.email.split("@")[0],
      role: m.role,
      isSelf: m.userId === userId,
      ...s,
    };
  });
  agents.sort(
    (a, b) =>
      b.submittedApCents - a.submittedApCents || b.apps - a.apps || b.dials - a.dials || b.leads - a.leads || a.name.localeCompare(b.name),
  );

  return NextResponse.json({
    team: ctx.organizationName,
    range,
    since: since?.toISOString() ?? null,
    until: until?.toISOString() ?? null,
    generatedAt: now.toISOString(),
    totals,
    activeAgents,
    members: agents.length,
    agents,
  });
}
