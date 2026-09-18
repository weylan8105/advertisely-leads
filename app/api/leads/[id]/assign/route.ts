import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/assign   Body: { userId: string | null }
 *
 * Manually (re)assign a lead to a member of the caller's organization — i.e.
 * distribute a lead to a downline agent — or unassign it (userId: null).
 * Only an OWNER/ADMIN of the org that holds the lead (or a platform ADMIN) may
 * reassign, and the target must be a member of that same org.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { userId?: string | null };
  const targetUserId =
    body.userId === null ? null : typeof body.userId === "string" && body.userId ? body.userId : undefined;
  if (targetUserId === undefined) {
    return NextResponse.json({ error: "userId is required (or null to unassign)" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, organizationId: true, assignedUserId: true, name: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const ctx = await ensureOrgContext(callerId);
  const managesLeadOrg =
    !!ctx && canManageTeam(ctx.role) && !!lead.organizationId && lead.organizationId === ctx.organizationId;
  if (!isPlatformAdmin && !managesLeadOrg) {
    return NextResponse.json(
      { error: "You can only reassign leads within your organization." },
      { status: 403 },
    );
  }

  const orgId = lead.organizationId ?? ctx?.organizationId ?? null;

  // The target must be a member of the org (unless unassigning, or platform admin).
  let targetName: string | null = null;
  if (targetUserId) {
    if (!isPlatformAdmin) {
      const member = orgId
        ? await prisma.membership.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
            select: { id: true },
          })
        : null;
      if (!member) {
        return NextResponse.json({ error: "That agent isn't in your organization." }, { status: 400 });
      }
    }
    const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    targetName = u?.name ?? null;
  }

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        assignedUserId: targetUserId,
        assignedAt: targetUserId ? new Date() : null,
        ...(orgId ? { organizationId: orgId } : {}),
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "LEAD_ASSIGNED",
        author: session?.user?.name ?? "Owner",
        body: targetUserId ? `Reassigned to ${targetName ?? "an agent"}.` : "Unassigned.",
      },
    }),
  ]);

  return NextResponse.json({ ok: true, assignedUserId: targetUserId, assignedAgentName: targetName });
}
