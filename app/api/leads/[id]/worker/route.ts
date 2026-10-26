import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { canActOnLead } from "@/lib/leadAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/leads/:id/worker — set who is working this lead (the initials
 * badge on the pipeline card). Body: { userId: string | null }.
 *
 * Anyone who can act on the lead may set it (so a Goldmine teammate can claim a
 * lead for themselves). The worker must be the lead's owner or a member of the
 * lead's team. This is only a "who's on it" marker — it never changes
 * assignedUserId, so ownership, P&L and delivery are untouched.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown };
  const workerId = typeof body.userId === "string" && body.userId ? body.userId : null;

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true, pipeline: true, workingUserId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canActOnLead(userId, isPlatformAdmin, lead))) {
    return NextResponse.json({ error: "You can't update this lead" }, { status: 403 });
  }
  if (workerId === lead.workingUserId) return NextResponse.json({ ok: true, workingUserId: workerId });

  let workerName: string | null = null;
  if (workerId) {
    const worker = await prisma.user.findUnique({ where: { id: workerId }, select: { name: true, email: true } });
    if (!worker) return NextResponse.json({ error: "That person wasn't found" }, { status: 400 });
    const onTeam =
      workerId === lead.assignedUserId ||
      (!!lead.organizationId &&
        !!(await prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId: lead.organizationId, userId: workerId } },
          select: { id: true },
        })));
    if (!onTeam) return NextResponse.json({ error: "That person isn't on this lead's team" }, { status: 400 });
    workerName = worker.name || worker.email || "a teammate";
  }

  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { workingUserId: workerId } }),
    prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "NOTE_ADDED",
        body: workerName ? `Now being worked by ${workerName}.` : "No one is marked as working this lead.",
      },
    }),
  ]);
  return NextResponse.json({ ok: true, workingUserId: workerId });
}
