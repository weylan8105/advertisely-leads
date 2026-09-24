import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { deliveredCounts } from "@/lib/orderProgress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/downline-orders
 * Admin-only. Every order across the platform that was placed for someone else's
 * downline (deliverToUserId set) — who bought it (upline), who it delivers to
 * (downline agent), which team, and live delivery progress.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const orders = await prisma.order.findMany({
    where: { deliverToUserId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      user: { select: { id: true, name: true, email: true } },
      organization: { select: { id: true, name: true } },
    },
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
    orders: orders.map((o) => {
      const agent = o.deliverToUserId ? agentById[o.deliverToUserId] : null;
      return {
        id: o.id,
        packageId: o.packageId,
        quantity: o.quantity,
        fulfilledCount: Math.min(live[o.id] ?? 0, o.quantity),
        status: o.status,
        createdAt: o.createdAt,
        buyerName: nm(o.user),
        buyerEmail: o.user?.email ?? null,
        agentName: nm(agent),
        agentEmail: agent?.email ?? null,
        orgName: o.organization?.name ?? null,
      };
    }),
  });
}
