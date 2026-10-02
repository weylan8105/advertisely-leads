import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { deliveredCounts } from "@/lib/orderProgress";
import { PIPELINE_STAGES } from "@/data/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/accounts
 * Admin-only. One row per client account with pipeline breakdown + conversion,
 * so an admin can see who's converting and who isn't.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const [leadGroups, soldLeads, orderAgg, latestOrders, users] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedUserId", "pipelineStage"],
      where: { assignedUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { assignedUserId: { not: null }, pipelineStage: "issued-paid" },
      select: { assignedUserId: true, soldPremiumCents: true },
    }),
    // Total spend + most-recent order date (aggregated across all their orders).
    prisma.order.groupBy({
      by: ["userId"],
      _sum: { totalCents: true },
      _max: { createdAt: true },
    }),
    // Every order — the progress bar sums the COMBINED total across all of a
    // client's orders (a client can place several at once, e.g. a 50 + a 25).
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, quantity: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, agency: true, phone: true } }),
  ]);

  const byUser: Record<string, { delivered: number; byStage: Record<string, number> }> = {};
  for (const g of leadGroups) {
    const u = g.assignedUserId as string;
    (byUser[u] ??= { delivered: 0, byStage: {} });
    byUser[u].byStage[g.pipelineStage] = g._count._all;
    byUser[u].delivered += g._count._all;
  }
  const soldByUser: Record<string, number> = {};
  const apByUser: Record<string, number> = {};
  for (const s of soldLeads) {
    const u = s.assignedUserId as string;
    soldByUser[u] = (soldByUser[u] ?? 0) + 1;
    apByUser[u] = (apByUser[u] ?? 0) + (s.soldPremiumCents ?? 0);
  }
  const spendByUser: Record<string, number> = {};
  const lastOrderByUser: Record<string, Date | null> = {};
  for (const o of orderAgg) {
    spendByUser[o.userId] = o._sum.totalCents ?? 0;
    lastOrderByUser[o.userId] = o._max.createdAt ?? null;
  }
  // ALL orders per user — progress is the COMBINED total across every order a
  // client has placed (e.g. a 50 + a 25 shows as one 75-lead bar), not just the
  // latest. (Luke places two at once; both must be visible.)
  const ordersByUser: Record<string, { id: string; quantity: number }[]> = {};
  for (const o of latestOrders) {
    (ordersByUser[o.userId] ??= []).push({ id: o.id, quantity: o.quantity });
  }
  // LIVE delivered count per order (non-trashed leads) so the bar reflects
  // reality and never drifts from the stored counter.
  const liveByOrder = await deliveredCounts(latestOrders.map((o) => o.id));
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  const ids = new Set<string>([...Object.keys(byUser), ...Object.keys(spendByUser)]);
  const accounts = [...ids]
    .map((id) => {
      const u = (userMap[id] ?? {}) as any;
      const d = byUser[id] ?? { delivered: 0, byStage: {} };
      const sold = soldByUser[id] ?? 0;
      return {
        userId: id,
        name: u.name ?? null,
        email: u.email ?? null,
        phone: u.phone ?? null,
        role: u.role ?? "AGENT",
        agency: u.agency ?? null,
        delivered: d.delivered,
        byStage: d.byStage,
        sold,
        apCents: apByUser[id] ?? 0,
        leadSpendCents: spendByUser[id] ?? 0,
        lastOrderAt: lastOrderByUser[id] ?? null,
        conversionPct: d.delivered > 0 ? Math.round((sold / d.delivered) * 100) : 0,
        // Progress = combined total across this client's INCOMPLETE orders only
        // (still being fulfilled), from a LIVE lead count. Fully delivered orders
        // are excluded, so the bar shows outstanding work — not lifetime history.
        // Each order is capped at its own quantity so overflow can't inflate it.
        orderedQty: (ordersByUser[id] ?? [])
          .filter((o) => (liveByOrder[o.id] ?? 0) < o.quantity)
          .reduce((s, o) => s + o.quantity, 0),
        fulfilledQty: (ordersByUser[id] ?? [])
          .filter((o) => (liveByOrder[o.id] ?? 0) < o.quantity)
          .reduce((s, o) => s + Math.min(liveByOrder[o.id] ?? 0, o.quantity), 0),
        orderProgressPct: (() => {
          const open = (ordersByUser[id] ?? []).filter((o) => (liveByOrder[o.id] ?? 0) < o.quantity);
          const ordered = open.reduce((s, o) => s + o.quantity, 0);
          if (ordered <= 0) return 0;
          const done = open.reduce((s, o) => s + Math.min(liveByOrder[o.id] ?? 0, o.quantity), 0);
          return Math.min(100, Math.round((done / ordered) * 100));
        })(),
      };
    })
    // Only real client accounts (have leads, spent, or placed an order).
    .filter((a) => a.email && (a.delivered > 0 || a.leadSpendCents > 0 || a.orderedQty > 0))
    .sort((a, b) => b.delivered - a.delivered);

  return NextResponse.json({
    accounts,
    stages: PIPELINE_STAGES.map((s) => ({ id: s.id, label: s.label })),
  });
}
