import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { ensureReferralCode } from "@/lib/referral";
import { uplineTeamFor } from "@/lib/upline";
import { quotaCountsThisWeek } from "@/lib/teamQuota";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team
 * Returns the caller's organization, their role, members (with lead counts),
 * and pending invitations. Agents get a read-only view; owners/admins see
 * everything and can manage seats. An agent who joined with an upline code and
 * isn't approved yet sees only themselves and the owner. Also returns the
 * caller's teams (for switching) and their upline code.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx) return NextResponse.json({ error: "No organization" }, { status: 404 });

  const memberships = await prisma.membership.findMany({
    where: {
      organizationId: ctx.organizationId,
      ...(ctx.pending ? { OR: [{ userId }, { role: "OWNER" as const }] } : {}),
    },
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Lead counts per member within this org (active = not REPLACED).
  const leadCounts = await prisma.lead.groupBy({
    by: ["assignedUserId"],
    // Leads in each member's own pipeline (Goldmine leads are the team's, not theirs).
    where: { organizationId: ctx.organizationId, assignedUserId: { not: null }, pipeline: "main", NOT: { status: "REPLACED" } },
    _count: { _all: true },
  });
  const countByUser: Record<string, number> = {};
  for (const r of leadCounts) if (r.assignedUserId) countByUser[r.assignedUserId] = r._count._all;

  // Weekly amounts: leads each member got from the owner's flow in the last 7 days.
  const quotaThisWeek = await quotaCountsThisWeek(
    ctx.organizationId,
    memberships.map((m) => m.userId),
  );

  const members = memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    inRotation: m.inRotation,
    pendingApproval: m.pendingApproval,
    weeklyLeadQuota: m.weeklyLeadQuota ?? 0,
    quotaThisWeek: quotaThisWeek.get(m.userId) ?? 0,
    leadCount: countByUser[m.userId] ?? 0,
    isSelf: m.userId === userId,
  }));

  const manage = canManageTeam(ctx.role);
  const invitations = manage
    ? await prisma.invitation.findMany({
        where: { organizationId: ctx.organizationId, status: "PENDING" },
        select: { id: true, email: true, role: true, token: true, createdAt: true, expiresAt: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  const [myTeams, myCode, myCodeTeam] = await Promise.all([
    prisma.membership.findMany({
      where: { userId },
      select: { role: true, pendingApproval: true, organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    ensureReferralCode(userId).catch(() => null),
    uplineTeamFor(userId),
  ]);

  return NextResponse.json({
    organization: {
      id: ctx.organizationId,
      name: ctx.organizationName,
      distributionMode: ctx.distributionMode,
    },
    role: ctx.role,
    canManage: manage,
    pending: ctx.pending,
    members,
    invitations,
    teams: myTeams.map((t) => ({
      id: t.organization.id,
      name: t.organization.name,
      role: t.role,
      pending: t.pendingApproval,
    })),
    // The caller's own upline code + the team it recruits into (null = their
    // own team, created when the first agent joins with it).
    upline: { code: myCode, team: myCodeTeam },
  });
}
