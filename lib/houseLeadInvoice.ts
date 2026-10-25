import { prisma } from "./prisma";
import { getBlendedAdSpend7d } from "./metaInsights";

/**
 * Weekly house-lead invoice: what each admin owes for the overflow/house leads
 * they took in the last 7 days, charged at the current blended cost-per-lead.
 *
 * CPL = (last-7d ad spend across BOTH ad accounts) / (last-7d leads generated).
 * When Meta isn't configured, falls back to the admin-set manual CPL so the
 * invoice still goes out; the lead counting is always from the DB.
 */

export interface HouseLeadInvoiceLine {
  userId: string;
  name: string;
  email: string;
  houseLeads: number;
  owedCents: number;
}

export interface HouseLeadInvoice {
  windowDays: number;
  sinceIso: string;
  untilIso: string;
  cplCents: number | null;
  cplSource: "meta" | "manual" | "none";
  spendCents: number;
  leadsGenerated: number;
  lines: HouseLeadInvoiceLine[];
  totalHouseLeads: number;
  totalOwedCents: number;
}

export async function buildHouseLeadInvoice(): Promise<HouseLeadInvoice | null> {
  if (!prisma) return null;
  const windowDays = 7;
  const until = new Date();
  const since = new Date(until.getTime() - windowDays * 86_400_000);

  // Numerator: blended spend across both ad accounts (last 7d).
  const spend = await getBlendedAdSpend7d();
  // Denominator: leads actually generated (received) in the window.
  const leadsGenerated = await prisma.lead.count({
    where: { receivedAt: { gte: since }, trashedAt: null },
  });

  // CPL: prefer live Meta spend; fall back to the admin-set manual CPL.
  let cplCents: number | null = null;
  let cplSource: HouseLeadInvoice["cplSource"] = "none";
  if (spend.configured && spend.spendCents > 0 && leadsGenerated > 0) {
    cplCents = Math.round(spend.spendCents / leadsGenerated);
    cplSource = "meta";
  } else {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN", manualCplCents: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { manualCplCents: true },
    });
    if (admin?.manualCplCents) {
      cplCents = admin.manualCplCents;
      cplSource = "manual";
    }
  }

  // Each admin's house leads = overflow (orderId null) assigned to them in the window.
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true },
  });
  const lines: HouseLeadInvoiceLine[] = [];
  for (const a of admins) {
    const houseLeads = await prisma.lead.count({
      where: { assignedUserId: a.id, orderId: null, trashedAt: null, assignedAt: { gte: since } },
    });
    if (houseLeads === 0) continue;
    lines.push({
      userId: a.id,
      name: a.name ?? a.email,
      email: a.email,
      houseLeads,
      owedCents: cplCents != null ? houseLeads * cplCents : 0,
    });
  }
  lines.sort((x, y) => y.houseLeads - x.houseLeads);

  return {
    windowDays,
    sinceIso: since.toISOString(),
    untilIso: until.toISOString(),
    cplCents,
    cplSource,
    spendCents: spend.spendCents,
    leadsGenerated,
    lines,
    totalHouseLeads: lines.reduce((s, l) => s + l.houseLeads, 0),
    totalOwedCents: lines.reduce((s, l) => s + l.owedCents, 0),
  };
}
