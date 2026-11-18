import { NextResponse } from "next/server";
import { membersFundThemselves } from "@/lib/teamAdvertiser";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { hasRingy } from "@/lib/ringyAccess";
import { ensureReferralCode } from "@/lib/referral";
import { uplineTeamFor } from "@/lib/upline";
import { teamBalances } from "@/lib/teamAdSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team
 * Returns the caller's organization, their role, members (with lead counts),
 * and pending invitations. Agents get a read-only view; owners/admins see
 * everything and can manage seats. Also returns the caller's teams (for
 * switching) and their upline code.
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
    where: { organizationId: ctx.organizationId },
    include: { user: { select: { id: true, name: true, email: true, image: true, isAdvertiser: true } } },
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

  // Advertiser team: members the owner lets add spend to the owner's campaign.
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { ownerId: true, owner: { select: { isAdvertiser: true, email: true } } },
  });
  // No "Ad spend on/off" switch on a team where members fund themselves (lib/teamAdvertiser.ts).
  const advertiserTeam = !!org?.owner?.isAdvertiser && !membersFundThemselves(org.owner.email);
  const credits = advertiserTeam && org ? await teamBalances(org.ownerId) : new Map<string, number>();

  // Ringy: a manager who has Ringy can link it for downlines (lib/ringyAccess.ts).
  const canLinkRingy = canManageTeam(ctx.role) && (await hasRingy(userId));
  const ringyRows = await prisma.integration.findMany({
    where: {
      type: "RINGY",
      enabled: true,
      userId: { in: canLinkRingy ? memberships.map((m) => m.userId) : [userId] },
    },
    select: { userId: true },
  });
  const ringyOn = new Set(ringyRows.map((r) => r.userId));

  const members = memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    goldmineAccess: !m.goldmineBlocked,
    // Runs their own campaign: managers see their weekly ad spend (/api/team/ad-spend).
    isAdvertiser: m.user.isAdvertiser,
    adSpendAccess: m.adSpendAccess,
    adSpendCreditCents: Math.max(0, credits.get(m.userId) ?? 0),
    leadCount: countByUser[m.userId] ?? 0,
    ringyConnected: ringyOn.has(m.userId),
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
      select: { role: true, organization: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    ensureReferralCode(userId).catch(() => null),
    uplineTeamFor(userId),
  ]);

  return NextResponse.json({
    organization: {
      id: ctx.organizationId,
      name: ctx.organizationName,
      leadDestination: ctx.leadDestination,
    },
    role: ctx.role,
    canManage: manage,
    goldmineOff: ctx.goldmineOff,
    advertiserTeam,
    canLinkRingy,
    members,
    invitations,
    teams: myTeams.map((t) => ({
      id: t.organization.id,
      name: t.organization.name,
      role: t.role,
    })),
    // The caller's own upline code + the team it recruits into (null = their
    // own team, created when the first agent joins with it).
    upline: { code: myCode, team: myCodeTeam },
  });
}
