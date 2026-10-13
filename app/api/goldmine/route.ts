import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { stagesForUser, normalizeStages } from "@/lib/pipelineStages";
import { RESERVED_STAGE_IDS, MIN_STAGES } from "@/data/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/goldmine — the caller's team Goldmine config + stage set.
 * Any member can read (to render the shared board); only managers can change it.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ enabled: false, stages: stagesForUser(null), canManage: false });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx) return NextResponse.json({ enabled: false, stages: stagesForUser(null), canManage: false });

  const org = await prisma.organization.findUnique({
    where: { id: ctx.organizationId },
    select: { goldmineEnabled: true, goldmineAfterDays: true, goldmineStages: true },
  });
  return NextResponse.json({
    enabled: !!org?.goldmineEnabled,
    afterDays: org?.goldmineAfterDays ?? null,
    stages: stagesForUser(org?.goldmineStages ?? null),
    reserved: RESERVED_STAGE_IDS,
    canManage: canManageTeam(ctx.role),
    organizationName: ctx.organizationName,
  });
}

/**
 * PUT /api/goldmine — update the team Goldmine config (managers only).
 * Body: { enabled?, afterDays?, stages? }
 */
export async function PUT(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx || !canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only a team owner or admin can change Goldmine settings." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enabled?: boolean;
    afterDays?: number | null;
    stages?: unknown;
  };

  const data: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") data.goldmineEnabled = body.enabled;
  if (body.afterDays === null) data.goldmineAfterDays = null;
  else if (typeof body.afterDays === "number" && Number.isFinite(body.afterDays)) {
    data.goldmineAfterDays = Math.max(1, Math.round(body.afterDays));
  }
  if (body.stages !== undefined) {
    const normalized = normalizeStages(body.stages);
    if (!normalized || normalized.length < MIN_STAGES) {
      return NextResponse.json({ error: `Add at least ${MIN_STAGES} stages, each with a name.` }, { status: 400 });
    }
    data.goldmineStages = normalized as any;
  }

  const org = await prisma.organization.update({
    where: { id: ctx.organizationId },
    data,
    select: { goldmineEnabled: true, goldmineAfterDays: true, goldmineStages: true },
  });
  return NextResponse.json({
    enabled: org.goldmineEnabled,
    afterDays: org.goldmineAfterDays ?? null,
    stages: stagesForUser(org.goldmineStages ?? null),
    reserved: RESERVED_STAGE_IDS,
    canManage: true,
  });
}
