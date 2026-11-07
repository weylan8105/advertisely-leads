import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { leadMatchesActiveOrder } from "@/lib/leadMatch";

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

  const body = (await req.json().catch(() => ({}))) as { userId?: string | null; force?: boolean };
  const targetUserId =
    body.userId === null ? null : typeof body.userId === "string" && body.userId ? body.userId : undefined;
  if (targetUserId === undefined) {
    return NextResponse.json({ error: "userId is required (or null to unassign)" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, organizationId: true, assignedUserId: true, name: true, state: true, receivedAt: true, packageId: true, pipeline: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const ctx = await ensureOrgContext(callerId);
  const managesLeadOrg =
    !!ctx && canManageTeam(ctx.role) && !!lead.organizationId && lead.organizationId === ctx.organizationId;
  // A manager's own lead that's filed under another team (they bought it while
  // an agent there) can still go to an agent on the team they run; it moves
  // to that team.
  const ownLeadFromOtherTeam =
    !managesLeadOrg && !!ctx && canManageTeam(ctx.role) && !!targetUserId &&
    lead.assignedUserId === callerId && lead.pipeline !== "goldmine";
  if (!isPlatformAdmin && !managesLeadOrg && !ownLeadFromOtherTeam) {
    return NextResponse.json(
      { error: "You can only reassign leads within your organization." },
      { status: 403 },
    );
  }

  let orgId = ownLeadFromOtherTeam ? ctx!.organizationId : lead.organizationId ?? ctx?.organizationId ?? null;
  // Platform admin handing the lead to someone outside its team: it moves into
  // the target's own team (and out of any Goldmine) so the right managers see it.
  let leaveGoldmine = false;

  // The target must be a member of the org (unless unassigning, or platform admin).
  let targetName: string | null = null;
  if (targetUserId) {
    const member = orgId
      ? await prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
          select: { id: true },
        })
      : null;
    if (!member) {
      if (!isPlatformAdmin) {
        return NextResponse.json({ error: "That agent isn't in your organization." }, { status: 400 });
      }
      const targetCtx = await ensureOrgContext(targetUserId);
      if (!targetCtx) return NextResponse.json({ error: "That account wasn't found." }, { status: 404 });
      orgId = targetCtx.organizationId;
      leaveGoldmine = lead.pipeline === "goldmine";
    }
    const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    targetName = u?.name ?? null;

    // Never hand a client (someone with an active order) a lead outside their
    // order's states/age window. Blocks off-state and aged manual assignments;
    // pass force:true to override deliberately.
    if (!body.force) {
      const match = await leadMatchesActiveOrder(targetUserId, lead);
      if (!match.ok) {
        return NextResponse.json(
          { error: `Can't assign this lead to ${targetName ?? "that agent"} — ${match.reason}. Pass force:true to override.` },
          { status: 422 },
        );
      }
    }
  }

  await prisma.$transaction([
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        assignedUserId: targetUserId,
        assignedAt: targetUserId ? new Date() : null,
        ...(orgId ? { organizationId: orgId } : {}),
        // Goldmine stages are the old team's; start fresh in the new agent's pipeline.
        ...(leaveGoldmine ? { pipeline: "main", pipelineStage: "new-lead", goldmineAt: null, workingUserId: null } : {}),
      },
    }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "LEAD_ASSIGNED",
        author: session?.user?.name ?? "Owner",
        body: targetUserId ? `Reassigned to ${targetName ?? "an agent"}.` : "Unassigned.",
        // Marks a transfer (not a delivery) for the "Delivered to your pipeline" count.
        metadata: { transfer: true, fromUserId: lead.assignedUserId ?? null, toUserId: targetUserId },
      },
    }),
  ]);

  return NextResponse.json({ ok: true, assignedUserId: targetUserId, assignedAgentName: targetName });
}
