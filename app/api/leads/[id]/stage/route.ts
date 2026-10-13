import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { WON_STAGE_ID } from "@/data/pipeline";
import { stagesForUser, labelForStage } from "@/lib/pipelineStages";
import { canActOnLead } from "@/lib/leadAccess";
import { fireMetaStageEvent } from "@/lib/metaCapi";

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

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true, pipeline: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (!(await canActOnLead(userId, isPlatformAdmin, lead))) {
    return NextResponse.json({ error: "You can't move this lead" }, { status: 403 });
  }

  // Validate against the right board: a Goldmine lead uses the TEAM's Goldmine
  // stages; a main lead uses whoever owns it (they may have customized theirs).
  let stages;
  if (lead.pipeline === "goldmine" && lead.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: lead.organizationId },
      select: { goldmineStages: true },
    });
    stages = stagesForUser(org?.goldmineStages ?? null);
  } else {
    const owner = lead.assignedUserId
      ? await prisma.user.findUnique({ where: { id: lead.assignedUserId }, select: { pipelineStages: true } })
      : null;
    stages = stagesForUser(owner?.pipelineStages ?? null);
  }
  if (!stages.some((s) => s.id === stage)) {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  // Marking a policy sold (the reserved "won" stage) captures the annual
  // premium for P&L; moving off that stage clears it.
  const isSold = stage === WON_STAGE_ID;
  const premiumCents =
    isSold && body.premiumCents != null ? Math.max(0, Math.round(Number(body.premiumCents))) : null;
  // Goldmine P&L credit goes to the CLOSER: when a downline moves a Goldmine
  // lead to the won stage, reassign it to them so the sale counts in their book.
  const creditCloser = isSold && lead.pipeline === "goldmine" && lead.assignedUserId !== userId;
  await prisma.lead.update({
    where: { id: params.id },
    data: {
      pipelineStage: stage,
      soldPremiumCents: isSold ? premiumCents : null,
      soldAt: isSold ? new Date() : null,
      ...(creditCloser ? { assignedUserId: userId, assignedAt: new Date() } : {}),
    },
  });
  await prisma.leadActivity.create({
    data: { leadId: params.id, type: "STATUS_CHANGED", body: `Moved to "${labelForStage(stages, stage)}" in the pipeline.` },
  });

  // Advancing to a high-intent stage (underwriting/approved/issued-not-paid/
  // issued-paid) signals the conversion back to Meta so it can find more people
  // like this lead. No-op for other stages, or if CAPI isn't configured yet.
  await fireMetaStageEvent(params.id, stage, isSold ? premiumCents : null);

  return NextResponse.json({ ok: true, stage });
}
