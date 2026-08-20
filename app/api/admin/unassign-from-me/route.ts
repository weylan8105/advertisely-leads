import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { DEFAULT_STAGE } from "@/data/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/unassign-from-me
 *
 * Return the admin's OWN zero-cost self-assigned leads to the house pool so
 * other clients can purchase them. Only touches leads assigned to the caller
 * that are NOT tied to a paid order (orderId = null) — never un-sells a
 * fulfilled order. Resets the pipeline stage so the next buyer gets a clean slate.
 *
 * Body: { quantity?: number, all?: boolean, states?: string[],
 *         ageMinDays?: number, ageMaxDays?: number }
 * Requires ADMIN role.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  const role = (session?.user as any)?.role;
  if (!userId || role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    quantity?: number;
    all?: boolean;
    states?: string[];
    ageMinDays?: number;
    ageMaxDays?: number;
  };

  const all = body.all === true;
  const quantity = Math.min(Math.max(parseInt(String(body.quantity), 10) || 0, 1), 5000);
  const states = Array.isArray(body.states)
    ? body.states.map((s) => String(s).toUpperCase()).filter(Boolean)
    : [];
  const ageMinDays = body.ageMinDays != null ? Number(body.ageMinDays) : undefined;
  const ageMaxDays = body.ageMaxDays != null ? Number(body.ageMaxDays) : undefined;

  const dayMs = 86_400_000;
  const nowMs = Date.now();
  const receivedAt: { gt?: Date; lte?: Date } = {};
  if (ageMaxDays != null) receivedAt.gt = new Date(nowMs - ageMaxDays * dayMs);
  if (ageMinDays != null) receivedAt.lte = new Date(nowMs - ageMinDays * dayMs);

  const where: any = {
    assignedUserId: userId,
    orderId: null, // only zero-cost self-assigned leads — never touch paid orders
    ...(states.length ? { state: { in: states } } : {}),
    ...(receivedAt.gt || receivedAt.lte ? { receivedAt } : {}),
  };

  const candidates = await prisma.lead.findMany({
    where,
    orderBy: { assignedAt: "asc" },
    ...(all ? {} : { take: quantity }),
    select: { id: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({ unassigned: 0, message: "You have no returnable leads matching that." });
  }

  const ids = candidates.map((c) => c.id);
  const result = await prisma.lead.updateMany({
    where: { id: { in: ids }, assignedUserId: userId, orderId: null },
    data: {
      assignedUserId: null,
      assignedAt: null,
      organizationId: null,
      pipelineStage: DEFAULT_STAGE, // clean slate for the next buyer
    },
  });
  await prisma.leadActivity.createMany({
    data: ids.map((id) => ({
      leadId: id,
      type: "LEAD_ASSIGNED" as const,
      body: "Returned to the house pool by admin (available for purchase).",
    })),
  });

  return NextResponse.json({ unassigned: result.count });
}
