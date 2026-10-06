import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getOrgContext, canManageTeam } from "@/lib/org";
import { stagesForUser, normalizeStages } from "@/lib/pipelineStages";
import { RESERVED_STAGE_IDS, MIN_STAGES } from "@/data/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pipeline/stages — the caller's CRM pipeline stages.
 * Managers may pass ?agent=<userId> to read a downline agent's stages
 * (read-only, so a team-overview board renders that agent's columns).
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ stages: stagesForUser(null), reserved: RESERVED_STAGE_IDS });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const agent = req.nextUrl.searchParams.get("agent");

  let targetId = userId;
  if (agent && agent !== userId) {
    let allowed = isAdmin;
    if (!allowed) {
      const ctx = await getOrgContext(userId);
      allowed = !!ctx && canManageTeam(ctx.role);
    }
    if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    targetId = agent;
  }

  const user = await prisma.user.findUnique({
    where: { id: targetId },
    select: { pipelineStages: true },
  });
  return NextResponse.json({
    stages: stagesForUser(user?.pipelineStages ?? null),
    reserved: RESERVED_STAGE_IDS,
  });
}

/**
 * PUT /api/pipeline/stages — save the caller's own customized stages.
 * Body: { stages: { id?, label, tone }[] }. The payload is sanitized and the
 * reserved anchors are re-inserted if absent, so the result is always valid.
 */
export async function PUT(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { stages?: unknown };
  const normalized = normalizeStages(body.stages);
  if (!normalized || normalized.length < MIN_STAGES) {
    return NextResponse.json(
      { error: `Add at least ${MIN_STAGES} stages, each with a name.` },
      { status: 400 },
    );
  }

  await prisma.user.update({
    where: { id: userId },
    data: { pipelineStages: normalized as any },
  });
  return NextResponse.json({ stages: normalized, reserved: RESERVED_STAGE_IDS });
}

/** DELETE /api/pipeline/stages — reset the caller's board to the default stages. */
export async function DELETE() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.user.update({ where: { id: userId }, data: { pipelineStages: null as any } });
  return NextResponse.json({ stages: stagesForUser(null), reserved: RESERVED_STAGE_IDS });
}
