import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { WON_STAGE_ID, CONVERSION_STAGE_IDS, isConversionStage } from "@/data/pipeline";
import { stagesForUser, labelForStage } from "@/lib/pipelineStages";
import { canActOnLead } from "@/lib/leadAccess";
import { fireMetaStageEvent, fireMetaContactedEvent, isPickupStage } from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_AP_CENTS = 1_000_000_00; // $1,000,000, same cap as the lead value field

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
    select: { id: true, assignedUserId: true, organizationId: true, pipeline: true, pipelineStage: true },
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

  // Underwriting and every stage after it is a submitted deal: the agent must
  // enter its annual premium (AP), which becomes the lead's value and counts on
  // the leaderboards right away. Marking it sold (the reserved "won" stage) also
  // logs that AP for P&L; moving off that stage clears it.
  const isSold = stage === WON_STAGE_ID;
  const isDeal = isConversionStage(stage);
  const rawAp = Math.round(Number(body.premiumCents));
  const apCents = Number.isFinite(rawAp) && rawAp > 0 ? Math.min(rawAp, MAX_AP_CENTS) : null;
  if (isDeal && apCents == null) {
    return NextResponse.json(
      { error: "Enter the annual premium (AP) for this deal before moving it. If this keeps happening, refresh the page." },
      { status: 400 },
    );
  }
  const premiumCents = isSold ? apCents : null;
  // The lead's first move into a deal stage is its submission (live deal alerts +
  // leaderboard "Submitted AP"); moving it along afterwards isn't a new deal.
  const firstSubmission =
    isDeal &&
    !isConversionStage(lead.pipelineStage ?? "") &&
    (await prisma.leadActivity.count({
      where: {
        leadId: lead.id,
        type: "STATUS_CHANGED",
        OR: CONVERSION_STAGE_IDS.map((id) => ({ metadata: { path: ["stage"], equals: id } })),
      },
    })) === 0;
  // Goldmine P&L credit goes to the CLOSER: when a downline moves a Goldmine
  // lead to the won stage, reassign it to them so the sale counts in their book.
  const creditCloser = isSold && lead.pipeline === "goldmine" && lead.assignedUserId !== userId;
  await prisma.lead.update({
    where: { id: params.id },
    data: {
      pipelineStage: stage,
      ...(isDeal ? { valueCents: apCents } : {}),
      soldPremiumCents: isSold ? premiumCents : null,
      soldAt: isSold ? new Date() : null,
      ...(creditCloser ? { assignedUserId: userId, assignedAt: new Date() } : {}),
    },
  });
  // metadata.stage/actorId power the Activity Dashboard + leaderboards
  // (lib/activityStats.ts): which funnel step this was, and who did it.
  const label = labelForStage(stages, stage);
  await prisma.leadActivity.create({
    data: {
      leadId: params.id,
      type: "STATUS_CHANGED",
      author: session?.user?.name ?? null,
      body: `Moved to "${label}" in the pipeline.`,
      metadata: {
        stage,
        label,
        actorId: userId,
        ...(isDeal ? { apCents } : {}),
        ...(firstSubmission ? { submitted: true } : {}),
      },
    },
  });

  // Advancing to a high-intent stage (underwriting/approved/issued-not-paid/
  // issued-paid) signals the conversion back to Meta so it can find more people
  // like this lead. No-op for other stages, or if CAPI isn't configured yet.
  // The first time a lead is picked up (Contacted, Call Back, Presentation Ran or
  // a closing stage), Meta also gets the lead's one "Contacted" quality signal.
  if (isPickupStage(stage)) await fireMetaContactedEvent(params.id).catch(() => {});
  await fireMetaStageEvent(params.id, stage, isSold ? premiumCents : null);

  return NextResponse.json({ ok: true, stage, valueCents: isDeal ? apCents : undefined });
}
