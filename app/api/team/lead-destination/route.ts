import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { primaryOwnedTeam } from "@/lib/org";
import { isLeadDestination } from "@/lib/leadDestination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The caller's owned teams (primary first) and how many others on each can work the Goldmine. */
async function ownedTeams(userId: string) {
  const user = await prisma!.user.findUnique({
    where: { id: userId },
    select: {
      isAdvertiser: true,
      defaultOrganizationId: true,
      ownedOrganizations: {
        select: {
          id: true,
          name: true,
          leadDestination: true,
          goldmineEnabled: true,
          memberships: { where: { userId: { not: userId } }, select: { goldmineBlocked: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!user) return null;
  const primary = primaryOwnedTeam(user.ownedOrganizations, user.defaultOrganizationId);
  return { user, primary };
}

/**
 * GET /api/team/lead-destination — where the caller's incoming leads land
 * (lib/leadDestination.ts). show = false for someone with no team members who
 * isn't an advertiser (the dashboard card stays hidden).
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const t = await ownedTeams(userId);
  const team = t?.primary;
  const members = team?.memberships.length ?? 0;
  return NextResponse.json({
    show: !!team && (members > 0 || !!t?.user.isAdvertiser),
    destination: team?.leadDestination ?? "PERSONAL",
    teamName: team?.name ?? null,
    members,
    goldmineMembers: team?.memberships.filter((m) => !m.goldmineBlocked).length ?? 0,
  });
}

/**
 * PATCH /api/team/lead-destination — { destination: "PERSONAL" | "SPLIT" | "GOLDMINE" }.
 * Set on every team the caller owns, so all their lead flows agree. Sending
 * leads to the Goldmine turns the Goldmine on for each team with someone to
 * work it.
 */
export async function PATCH(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { destination?: unknown };
  if (!isLeadDestination(body.destination)) {
    return NextResponse.json({ error: "destination must be PERSONAL, SPLIT or GOLDMINE" }, { status: 400 });
  }
  const destination = body.destination;
  const t = await ownedTeams(userId);
  if (!t?.primary) return NextResponse.json({ error: "You don't own a team" }, { status: 404 });
  if (destination !== "PERSONAL" && !t.primary.memberships.some((m) => !m.goldmineBlocked)) {
    return NextResponse.json(
      { error: "Add a team member with Goldmine access first, so someone can work your Goldmine leads." },
      { status: 400 },
    );
  }

  const ids = t.user.ownedOrganizations.map((o) => o.id);
  await prisma.organization.updateMany({ where: { id: { in: ids } }, data: { leadDestination: destination } });
  if (destination !== "PERSONAL") {
    const withWorkers = t.user.ownedOrganizations
      .filter((o) => !o.goldmineEnabled && o.memberships.some((m) => !m.goldmineBlocked))
      .map((o) => o.id);
    if (withWorkers.length) {
      await prisma.organization.updateMany({ where: { id: { in: withWorkers } }, data: { goldmineEnabled: true } });
    }
  }
  return NextResponse.json({ ok: true, destination });
}
