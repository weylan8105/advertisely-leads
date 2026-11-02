import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import {
  activityByUser,
  addStats,
  emptyStats,
  hasActivity,
  parsePeriod,
  periodStart,
  type ActivityStats,
} from "@/lib/activityStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scope = "agents" | "teams" | "my-team";

interface Row extends ActivityStats {
  id: string;
  name: string;
  image: string | null;
  subtitle: string | null; // agents: their team; teams: "N members"
  isMe: boolean;
}

/**
 * GET /api/leaderboard?period=…&scope=agents|teams|my-team
 *   agents  — every producer on Advertisely with activity in the period
 *   teams   — every team with 2+ members, totals of its members
 *   my-team — the caller's teammates (null rows when they have no team)
 * Signed-in users only; returns names + production numbers, never contact info.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const params = new URL(req.url).searchParams;
  const period = parsePeriod(params.get("period"));
  const scope: Scope = (["agents", "teams", "my-team"] as const).find((s) => s === params.get("scope")) ?? "agents";
  const since = await periodStart(period);

  // Teams = organizations with at least two members.
  const orgs = await prisma.organization.findMany({
    select: {
      id: true,
      name: true,
      owner: { select: { id: true, name: true, image: true } },
      memberships: { select: { userId: true, user: { select: { id: true, name: true, email: true, image: true } } } },
    },
  });
  const teams = orgs.filter((o) => o.memberships.length >= 2);
  const myTeams = teams.filter((t) => t.memberships.some((m) => m.userId === userId));
  const display = (u: { name: string | null; email?: string | null }) => u.name?.trim() || u.email?.split("@")[0] || "Agent";

  if (scope === "my-team") {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { defaultOrganizationId: true } });
    const team = myTeams.find((t) => t.id === me?.defaultOrganizationId) ?? myTeams[0];
    if (!team) return NextResponse.json({ period, since, scope, team: null, rows: [] });
    const ids = team.memberships.map((m) => m.userId);
    const stats = await activityByUser(since, ids);
    const rows: Row[] = team.memberships.map((m) => ({
      ...(stats.get(m.userId) ?? emptyStats()),
      id: m.userId,
      name: display(m.user),
      image: m.user.image,
      subtitle: m.userId === team.owner.id ? "Team leader" : null,
      isMe: m.userId === userId,
    }));
    return NextResponse.json({ period, since, scope, team: { id: team.id, name: team.name }, rows });
  }

  const stats = await activityByUser(since);

  if (scope === "teams") {
    const rows: Row[] = teams
      .map((t) => {
        const total = t.memberships.reduce((acc, m) => addStats(acc, stats.get(m.userId) ?? emptyStats()), emptyStats());
        return {
          ...total,
          id: t.id,
          name: t.name,
          image: t.owner.image,
          subtitle: `${t.memberships.length} members · led by ${display(t.owner)}`,
          isMe: myTeams.some((m) => m.id === t.id),
        };
      });
    return NextResponse.json({ period, since, scope, rows });
  }

  const ids = Array.from(stats.entries()).filter(([, s]) => hasActivity(s)).map(([id]) => id);
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, image: true } });
  const teamOf = new Map<string, string>();
  for (const t of teams) for (const m of t.memberships) if (!teamOf.has(m.userId)) teamOf.set(m.userId, t.name);
  const rows: Row[] = users.map((u) => ({
    ...(stats.get(u.id) ?? emptyStats()),
    id: u.id,
    name: display(u),
    image: u.image,
    subtitle: teamOf.get(u.id) ?? null,
    isMe: u.id === userId,
  }));
  return NextResponse.json({ period, since, scope, rows });
}
