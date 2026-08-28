import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
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

  const [leadGroups, soldLeads, orderAgg, users] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedUserId", "pipelineStage"],
      where: { assignedUserId: { not: null } },
      _count: { _all: true },
    }),
    prisma.lead.findMany({
      where: { assignedUserId: { not: null }, pipelineStage: "issued-paid" },
      select: { assignedUserId: true, soldPremiumCents: true },
    }),
    prisma.order.groupBy({
      by: ["userId"],
      _sum: { totalCents: true },
      _max: { createdAt: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, agency: true } }),
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
        role: u.role ?? "AGENT",
        agency: u.agency ?? null,
        delivered: d.delivered,
        byStage: d.byStage,
        sold,
        apCents: apByUser[id] ?? 0,
        leadSpendCents: spendByUser[id] ?? 0,
        lastOrderAt: lastOrderByUser[id] ?? null,
        conversionPct: d.delivered > 0 ? Math.round((sold / d.delivered) * 100) : 0,
      };
    })
    // Only real client accounts (have leads or have spent) — skip empty users.
    .filter((a) => a.email && (a.delivered > 0 || a.leadSpendCents > 0))
    .sort((a, b) => b.delivered - a.delivered);

  return NextResponse.json({
    accounts,
    stages: PIPELINE_STAGES.map((s) => ({ id: s.id, label: s.label })),
  });
}
