import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { INTAKE_STAGE_ID, GOLDMINE_ELIGIBLE_STAGE_IDS } from "@/data/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BULK = 1000;

/**
 * POST /api/leads/move-to-goldmine   Body: { leadIds: string[] }
 *
 * Manually move leads from the caller's own pipeline into their team's shared
 * Goldmine — the same move the daily auto-sweep makes for aged leads, just on
 * demand. Same rules as the sweep: only a team owner/admin, only their OWN
 * main-pipeline leads in New Lead / Dialed / Contacted / Call Back with no upcoming
 * callback; each lead restarts at the Goldmine
 * intake stage. Leads that don't qualify are skipped (reported in `skipped`).
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const userName = ((session?.user as any)?.name as string | undefined) ?? "you";
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { leadIds?: unknown };
  const leadIds = Array.isArray(body.leadIds)
    ? Array.from(new Set(body.leadIds.filter((x): x is string => typeof x === "string" && !!x)))
    : [];
  if (leadIds.length === 0) return NextResponse.json({ error: "leadIds is required" }, { status: 400 });
  if (leadIds.length > MAX_BULK) {
    return NextResponse.json({ error: `You can move up to ${MAX_BULK} leads at once.` }, { status: 400 });
  }

  const ctx = await ensureOrgContext(userId);
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only a team owner or admin can move leads into Goldmine." }, { status: 403 });
  }
  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { goldmineEnabled: true },
  });
  if (!org?.goldmineEnabled) {
    return NextResponse.json({ error: "Goldmine isn't turned on for your team yet. Turn it on from the Goldmine page." }, { status: 409 });
  }

  const eligible = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      assignedUserId: userId,
      pipeline: "main",
      trashedAt: null,
      pipelineStage: { in: [...GOLDMINE_ELIGIBLE_STAGE_IDS] },
      OR: [{ callbackAt: null }, { callbackAt: { lte: new Date() } }],
    },
    select: { id: true },
  });
  const ids = eligible.map((l) => l.id);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "None of those leads can be moved. Only your own leads in New Lead, Dialed, Contacted or Call Back (with no upcoming callback) can go to Goldmine." },
      { status: 400 },
    );
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.lead.updateMany({
      where: { id: { in: ids } },
      // Into this team's pool (the Goldmine board lists by organization), fresh
      // at the intake stage so the team works them anew — same as the sweep.
      data: { pipeline: "goldmine", goldmineAt: now, pipelineStage: INTAKE_STAGE_ID, organizationId: ctx.organizationId, workingUserId: null },
    }),
    prisma.leadActivity.createMany({
      data: ids.map((leadId) => ({
        leadId,
        type: "STATUS_CHANGED" as const,
        body: `Moved to Goldmine by ${userName}.`,
      })),
    }),
  ]);

  return NextResponse.json({ ok: true, count: ids.length, skipped: leadIds.length - ids.length });
}
