import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/overview
 *
 * Real numbers for the admin Operations console: pipeline stat cards and the
 * live client-accounts table. Replaces the hardcoded demo figures.
 *
 * Requires ADMIN role.
 */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({
      stats: { leadsInDatabase: 0, unassignedLeads: 0, soldLeads: 0, activeClientAccounts: 0 },
      accounts: [],
    });
  }

  const [leadsInDatabase, unassignedLeads, soldLeads, orders, users] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.count({ where: { assignedUserId: null } }),
    prisma.lead.count({ where: { assignedUserId: { not: null } } }),
    prisma.order.findMany({
      select: { userId: true, totalCents: true, status: true, createdAt: true },
    }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true, agency: true, role: true },
    }),
  ]);

  // Aggregate orders per user.
  const byUser = new Map<string, { spend: number; last: Date | null; delivered: boolean }>();
  for (const o of orders) {
    const cur = byUser.get(o.userId) ?? { spend: 0, last: null, delivered: false };
    cur.spend += o.totalCents;
    if (!cur.last || o.createdAt > cur.last) cur.last = o.createdAt;
    if (o.status === "DELIVERED" || o.status === "DELIVERING") cur.delivered = true;
    byUser.set(o.userId, cur);
  }

  // Seat counts per agency (users sharing an agency label).
  const seatsByAgency = new Map<string, number>();
  for (const u of users) {
    const key = u.agency?.trim() || `__user_${u.id}`;
    seatsByAgency.set(key, (seatsByAgency.get(key) ?? 0) + 1);
  }

  // One account row per paying user (has at least one order).
  const accounts = users
    .filter((u) => byUser.has(u.id))
    .map((u) => {
      const agg = byUser.get(u.id)!;
      const agencyKey = u.agency?.trim() || `__user_${u.id}`;
      return {
        name: u.agency?.trim() || u.name || u.email,
        seats: seatsByAgency.get(agencyKey) ?? 1,
        lifetimeSpendCents: agg.spend,
        lastOrder: agg.last,
        status: agg.delivered ? "Active" : "Trial",
      };
    })
    .sort((a, b) => b.lifetimeSpendCents - a.lifetimeSpendCents);

  return NextResponse.json({
    stats: {
      leadsInDatabase,
      unassignedLeads,
      soldLeads,
      activeClientAccounts: byUser.size,
    },
    accounts,
  });
}
