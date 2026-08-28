import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { findPackage } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/pnl — the caller's Profit & Loss.
 * Owners/admins see their whole org; agents see their own book.
 *
 * Net = commission (annual premium logged on sold policies) + buyback − lead spend.
 * Lead spend = what was paid for leads (order totals; $0 for free self-assigned).
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  const manage = !!ctx && canManageTeam(ctx.role);
  const leadWhere = manage ? { organizationId: ctx!.organizationId } : { assignedUserId: userId };
  const orderWhere = manage ? { organizationId: ctx!.organizationId } : { userId };

  const [leads, orders] = await Promise.all([
    prisma.lead.findMany({
      where: leadWhere as any,
      select: { pipelineStage: true, soldPremiumCents: true, orderId: true, packageId: true },
    }),
    prisma.order.findMany({
      where: orderWhere as any,
      select: { id: true, packageId: true, totalCents: true, quantity: true, createdAt: true },
    }),
  ]);

  const QUOTED = new Set(["presentation-ran", "underwriting", "approved"]);
  const INTAKE = new Set(["new-lead", "aged-lead"]);

  const delivered = leads.length;
  const worked = leads.filter((l) => !INTAKE.has(l.pipelineStage)).length;
  const quoted = leads.filter((l) => QUOTED.has(l.pipelineStage)).length;
  const soldLeads = leads.filter((l) => l.pipelineStage === "issued-paid");
  const policiesSold = soldLeads.length;

  const apCents = soldLeads.reduce((s, l) => s + (l.soldPremiumCents ?? 0), 0);
  const commissionCents = apCents; // first-year comp model (AP = commission)
  const costCents = orders.reduce((s, o) => s + o.totalCents, 0);
  const buybackCents = 0; // reserved: credit for replaced/dead leads
  const netCents = commissionCents + buybackCents - costCents;
  const roi = costCents > 0 ? (commissionCents + buybackCents) / costCents : null;

  // By campaign (order)
  const del: Record<string, number> = {};
  const closed: Record<string, number> = {};
  const prem: Record<string, number> = {};
  for (const l of leads) {
    if (!l.orderId) continue;
    del[l.orderId] = (del[l.orderId] ?? 0) + 1;
    if (l.pipelineStage === "issued-paid") {
      closed[l.orderId] = (closed[l.orderId] ?? 0) + 1;
      prem[l.orderId] = (prem[l.orderId] ?? 0) + (l.soldPremiumCents ?? 0);
    }
  }
  const campaigns = orders
    .map((o) => {
      const ap = prem[o.id] ?? 0;
      return {
        id: o.id,
        name: findPackage(o.packageId)?.name ?? o.packageId,
        createdAt: o.createdAt,
        delivered: del[o.id] ?? 0,
        closed: closed[o.id] ?? 0,
        apCents: ap,
        commissionCents: ap,
        costCents: o.totalCents,
        netCents: ap - o.totalCents,
        roi: o.totalCents > 0 ? ap / o.totalCents : null,
      };
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));

  // By lead type — the IUL market (all current inventory is Blue Collar IUL).
  const byLeadType = [
    {
      market: "Blue Collar IUL",
      delivered,
      closed: policiesSold,
      apCents,
      commissionCents,
      costCents,
      netCents,
      roi,
    },
  ];

  return NextResponse.json({
    summary: { netCents, commissionCents, costCents, buybackCents, policiesSold, delivered, apCents, roi },
    funnel: { delivered, worked, quoted, closed: policiesSold },
    byLeadType,
    campaigns,
  });
}
