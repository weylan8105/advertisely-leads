import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team
 * Returns the caller's organization, their role, members (with lead counts),
 * and pending invitations. Agents get a read-only view; owners/admins see
 * everything and can manage seats.
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
    include: { user: { select: { id: true, name: true, email: true, image: true } } },
    orderBy: { createdAt: "asc" },
  });

  // Lead counts per member within this org (active = not REPLACED).
  const leadCounts = await prisma.lead.groupBy({
    by: ["assignedUserId"],
    where: { organizationId: ctx.organizationId, assignedUserId: { not: null }, NOT: { status: "REPLACED" } },
    _count: { _all: true },
  });
  const countByUser: Record<string, number> = {};
  for (const r of leadCounts) if (r.assignedUserId) countByUser[r.assignedUserId] = r._count._all;

  const members = memberships.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    name: m.user.name,
    email: m.user.email,
    image: m.user.image,
    role: m.role,
    inRotation: m.inRotation,
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

  return NextResponse.json({
    organization: {
      id: ctx.organizationId,
      name: ctx.organizationName,
      distributionMode: ctx.distributionMode,
    },
    role: ctx.role,
    canManage: manage,
    members,
    invitations,
  });
}
