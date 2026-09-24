import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { deliveredCounts } from "@/lib/orderProgress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team/orders
 * Owner/admin view: every order the team placed that delivers to a downline
 * agent (deliverToUserId set), with live delivery progress. Lets an upline watch
 * the progress of leads bought for their agents from the team manager — without
 * the leads ever landing in the upline's own pipeline.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx) return NextResponse.json({ orders: [], canManage: false });
  if (!canManageTeam(ctx.role)) {
    // Agents don't see the team's buying — only owners/admins.
    return NextResponse.json({ orders: [], canManage: false });
  }

  const orders = await prisma.order.findMany({
    where: { organizationId: ctx.organizationId, deliverToUserId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  const live = await deliveredCounts(orders.map((o) => o.id));

  // deliverToUserId is a scalar (no relation) — resolve agent names in one query.
  const agentIds = [...new Set(orders.map((o) => o.deliverToUserId).filter(Boolean))] as string[];
  const agents = agentIds.length
    ? await prisma.user.findMany({ where: { id: { in: agentIds } }, select: { id: true, name: true, email: true } })
    : [];
  const agentById = Object.fromEntries(agents.map((a) => [a.id, a]));
  const nm = (u: { name: string | null; email: string } | null | undefined) =>
    u ? u.name ?? u.email.split("@")[0] : null;

  return NextResponse.json({
    canManage: true,
    orders: orders.map((o) => ({
      id: o.id,
      packageId: o.packageId,
      quantity: o.quantity,
      fulfilledCount: Math.min(live[o.id] ?? 0, o.quantity),
      status: o.status,
      createdAt: o.createdAt,
      agentName: nm(o.deliverToUserId ? agentById[o.deliverToUserId] : null),
      buyerName: nm(o.user),
      buyerIsSelf: o.userId === userId,
    })),
  });
}
