import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { canActOnLead } from "@/lib/leadAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_COLUMN = 2000;

/**
 * POST /api/leads/reorder   Body: { stage: string; orderedIds: string[] }
 *
 * Saves the manual top-to-bottom order of one pipeline column (the order the
 * agent dragged cards into). Each listed lead that's in that stage and that the
 * caller may act on gets stageRank = its position; anything else is skipped.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";

  const body = (await req.json().catch(() => ({}))) as { stage?: unknown; orderedIds?: unknown };
  const stage = typeof body.stage === "string" ? body.stage : "";
  const orderedIds = Array.isArray(body.orderedIds)
    ? Array.from(new Set(body.orderedIds.filter((x): x is string => typeof x === "string" && !!x)))
    : [];
  if (!stage || orderedIds.length === 0) {
    return NextResponse.json({ error: "stage and orderedIds are required" }, { status: 400 });
  }
  if (orderedIds.length > MAX_COLUMN) {
    return NextResponse.json({ error: "Too many leads in one column" }, { status: 400 });
  }

  const leads = await prisma.lead.findMany({
    where: { id: { in: orderedIds }, pipelineStage: stage, trashedAt: null },
    select: { id: true, assignedUserId: true, organizationId: true, pipeline: true },
  });
  // Same access rule as moving a single card.
  const allowed = new Set<string>();
  for (const l of leads) {
    if (await canActOnLead(userId, isPlatformAdmin, l)) allowed.add(l.id);
  }
  const ranked = orderedIds.map((id, i) => ({ id, rank: i + 1 })).filter((r) => allowed.has(r.id));
  if (ranked.length === 0) return NextResponse.json({ ok: true, count: 0 });

  // One parameterized UPDATE for the whole column.
  const values = Prisma.join(ranked.map((r) => Prisma.sql`(${r.id}, ${r.rank}::float8)`));
  await prisma.$executeRaw`UPDATE "Lead" AS l SET "stageRank" = v.rank FROM (VALUES ${values}) AS v(id, rank) WHERE l.id = v.id`;
  return NextResponse.json({ ok: true, count: ranked.length });
}
