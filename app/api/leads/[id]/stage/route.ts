import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getOrgContext, canManageTeam } from "@/lib/org";
import { STAGE_IDS, stageLabel } from "@/data/pipeline";
import { fireMetaPurchaseEvent } from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/leads/:id/stage — move a lead to a CRM pipeline stage.
 * Body: { stage: string }  (must be a valid stage id)
 * Allowed if the lead is assigned to the caller, the caller is a platform
 * admin, or the caller manages the lead's organization.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";

  const body = (await req.json().catch(() => ({}))) as { stage?: string; premiumCents?: number };
  const stage = body.stage ?? "";
  if (!STAGE_IDS.includes(stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  let allowed = isPlatformAdmin || lead.assignedUserId === userId;
  if (!allowed && lead.organizationId) {
    const ctx = await getOrgContext(userId);
    allowed = !!ctx && ctx.organizationId === lead.organizationId && canManageTeam(ctx.role);
  }
  if (!allowed) return NextResponse.json({ error: "You can't move this lead" }, { status: 403 });

  // Marking a policy sold ("Issued PAID") captures the annual premium for P&L;
  // moving off that stage clears it.
  const isSold = stage === "issued-paid";
  const premiumCents =
    isSold && body.premiumCents != null ? Math.max(0, Math.round(Number(body.premiumCents))) : null;
  await prisma.lead.update({
    where: { id: params.id },
    data: {
      pipelineStage: stage,
      soldPremiumCents: isSold ? premiumCents : null,
      soldAt: isSold ? new Date() : null,
    },
  });
  await prisma.leadActivity.create({
    data: { leadId: params.id, type: "STATUS_CHANGED", body: `Moved to "${stageLabel(stage)}" in the pipeline.` },
  });

  // Sold → fire the server-side Meta "Purchase" conversion (no-op if unconfigured).
  if (isSold) await fireMetaPurchaseEvent(params.id, premiumCents);

  return NextResponse.json({ ok: true, stage });
}
