import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BULK = 1000;

/**
 * POST /api/leads/assign-bulk   Body: { leadIds: string[]; userId: string | null }
 *
 * Bulk (re)assign the selected leads to a downline agent — or unassign them all
 * (userId: null) — in one action. Same authorization as the single-lead assign
 * route: a platform ADMIN may move any lead; an org OWNER/ADMIN may only move
 * leads their org holds, and only to a member of that same org. Leads the caller
 * isn't allowed to touch are skipped (reported in `skipped`) rather than failing
 * the whole batch.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { leadIds?: unknown; userId?: string | null };
  const leadIds = Array.isArray(body.leadIds)
    ? Array.from(new Set(body.leadIds.filter((x): x is string => typeof x === "string" && !!x)))
    : [];
  const targetUserId =
    body.userId === null ? null : typeof body.userId === "string" && body.userId ? body.userId : undefined;

  if (leadIds.length === 0) {
    return NextResponse.json({ error: "leadIds is required" }, { status: 400 });
  }
  if (leadIds.length > MAX_BULK) {
    return NextResponse.json({ error: `Too many leads at once (max ${MAX_BULK}).` }, { status: 400 });
  }
  if (targetUserId === undefined) {
    return NextResponse.json({ error: "userId is required (or null to unassign)" }, { status: 400 });
  }

  const ctx = await ensureOrgContext(callerId);
  const canManage = !!ctx && canManageTeam(ctx.role);
  if (!isPlatformAdmin && !canManage) {
    return NextResponse.json(
      { error: "You can only reassign leads within your organization." },
      { status: 403 },
    );
  }

  // When assigning to an agent (not unassigning), the target must be a member of
  // the caller's org — unless the caller is a platform admin.
  let targetName: string | null = null;
  if (targetUserId) {
    if (!isPlatformAdmin) {
      const member = ctx?.organizationId
        ? await prisma.membership.findUnique({
            where: { organizationId_userId: { organizationId: ctx.organizationId, userId: targetUserId } },
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

  // Load the requested leads and keep only the ones this caller may move.
  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, organizationId: true },
  });
  const allowed = isPlatformAdmin
    ? leads
    : leads.filter((l) => !!l.organizationId && l.organizationId === ctx!.organizationId);
  const allowedIds = allowed.map((l) => l.id);
  const skipped = leadIds.length - allowedIds.length;

  if (allowedIds.length === 0) {
    return NextResponse.json(
      { error: "None of the selected leads are in your organization.", skipped },
      { status: 403 },
    );
  }

  const now = new Date();
  const result = await prisma.$transaction([
    prisma.lead.updateMany({
      where: { id: { in: allowedIds } },
      // Leads keep their existing organizationId; bulk assign only changes owner.
      data: {
        assignedUserId: targetUserId,
        assignedAt: targetUserId ? now : null,
      },
    }),
    prisma.leadActivity.createMany({
      data: allowedIds.map((leadId) => ({
        leadId,
        type: "LEAD_ASSIGNED" as const,
        author: session?.user?.name ?? "Owner",
        body: targetUserId ? `Bulk-reassigned to ${targetName ?? "an agent"}.` : "Bulk-unassigned.",
      })),
    }),
  ]);

  return NextResponse.json({
    ok: true,
    assignedUserId: targetUserId,
    assignedAgentName: targetName,
    count: result[0].count,
    skipped,
  });
}
