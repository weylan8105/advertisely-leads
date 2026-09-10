import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/leads/delete
 * Body: { leadIds: string[] }
 * Permanently deletes leads (and their activity/notes/tasks/replacement requests).
 * If a deleted lead was on an order, that order's fulfilledCount is decremented
 * so delivery counts stay accurate. Admin only.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const db = prisma;

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  const ids = Array.isArray(body.leadIds) ? body.leadIds.map(String).filter(Boolean) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "No leadIds provided" }, { status: 400 });
  }
  if (ids.length > 500) {
    return NextResponse.json({ error: "Delete at most 500 at a time" }, { status: 400 });
  }

  // Which orders are affected, and by how many, so we can fix fulfilledCounts.
  const leads = await db.lead.findMany({
    where: { id: { in: ids } },
    select: { id: true, orderId: true },
  });
  if (leads.length === 0) {
    return NextResponse.json({ deleted: 0 });
  }
  const foundIds = leads.map((l) => l.id);
  const perOrder = new Map<string, number>();
  for (const l of leads) {
    if (l.orderId) perOrder.set(l.orderId, (perOrder.get(l.orderId) ?? 0) + 1);
  }
  const orders = perOrder.size
    ? await db.order.findMany({
        where: { id: { in: [...perOrder.keys()] } },
        select: { id: true, fulfilledCount: true, quantity: true },
      })
    : [];

  await db.$transaction([
    db.leadActivity.deleteMany({ where: { leadId: { in: foundIds } } }),
    db.leadNote.deleteMany({ where: { leadId: { in: foundIds } } }),
    db.task.deleteMany({ where: { leadId: { in: foundIds } } }),
    db.replacementRequest.deleteMany({ where: { leadId: { in: foundIds } } }),
    db.lead.deleteMany({ where: { id: { in: foundIds } } }),
    ...orders.map((o) => {
      const newFulfilled = Math.max(0, o.fulfilledCount - (perOrder.get(o.id) ?? 0));
      return db.order.update({
        where: { id: o.id },
        data: {
          fulfilledCount: newFulfilled,
          status: newFulfilled >= o.quantity ? "DELIVERED" : newFulfilled > 0 ? "DELIVERING" : "PROCESSING",
          fulfilledAt: newFulfilled >= o.quantity ? undefined : null,
        },
      });
    }),
  ]);

  return NextResponse.json({ deleted: foundIds.length, ordersAdjusted: orders.length });
}
