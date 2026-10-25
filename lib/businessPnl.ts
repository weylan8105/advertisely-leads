import { prisma } from "./prisma";
import { getBlendedAdSpendRange } from "./metaInsights";

/**
 * Advertisely's own business P&L for a window — distinct from the per-agent
 * commission P&L (/api/pnl). Revenue = client lead sales (cash) + PAID house-lead
 * reimbursements. Costs = ad spend + Stripe processing fees. Shows both the
 * Scenario-2 margin (admins pay for their own leads) and Scenario-1 (they don't).
 *
 * Ad spend comes from Meta (both accounts) when configured; otherwise it's
 * estimated as (manual CPL) x (leads generated in the window), and flagged.
 */

const STRIPE_PCT = 0.029;
const STRIPE_FLAT_CENTS = 30;

export type BizRange = "mtd" | "7d" | "30d";

function windowFor(range: BizRange): { since: Date; until: Date } {
  const until = new Date();
  if (range === "7d") return { since: new Date(until.getTime() - 7 * 86_400_000), until };
  if (range === "30d") return { since: new Date(until.getTime() - 30 * 86_400_000), until };
  // mtd
  return { since: new Date(Date.UTC(until.getUTCFullYear(), until.getUTCMonth(), 1)), until };
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface BusinessPnl {
  range: BizRange;
  sinceIso: string;
  untilIso: string;
  leadsGenerated: number;
  cplCents: number | null;
  adSpendCents: number;
  adSpendSource: "meta" | "manual-estimate" | "none";
  clientRevenueCents: number;
  clientLeadsSold: number;
  stripeFeesCents: number;
  reimbursementCents: number; // PAID house-lead settlements in window
  reimbursementPending: number; // count of PENDING settlements (not yet counted)
  reimbursementPendingCents: number;
  // Scenario 2: admins pay for their leads (reimbursements count as revenue)
  netScenario2Cents: number;
  marginScenario2: number | null;
  // Scenario 1: admins don't pay
  netScenario1Cents: number;
  marginScenario1: number | null;
}

export async function buildBusinessPnl(range: BizRange = "mtd"): Promise<BusinessPnl | null> {
  if (!prisma) return null;
  const { since, until } = windowFor(range);

  // Leads generated (received) in window.
  const leadsGenerated = await prisma.lead.count({ where: { receivedAt: { gte: since }, trashedAt: null } });

  // Ad spend: Meta range if configured, else manual CPL x leads.
  const spend = await getBlendedAdSpendRange(ymd(since), ymd(until));
  let adSpendCents = 0;
  let adSpendSource: BusinessPnl["adSpendSource"] = "none";
  let cplCents: number | null = null;
  if (spend.configured && spend.spendCents > 0) {
    adSpendCents = spend.spendCents;
    adSpendSource = "meta";
    cplCents = leadsGenerated > 0 ? Math.round(adSpendCents / leadsGenerated) : null;
  } else {
    const admin = await prisma.user.findFirst({ where: { role: "ADMIN", manualCplCents: { not: null } }, orderBy: { createdAt: "asc" }, select: { manualCplCents: true } });
    if (admin?.manualCplCents) {
      cplCents = admin.manualCplCents;
      adSpendCents = cplCents * leadsGenerated;
      adSpendSource = "manual-estimate";
    }
  }

  // Client lead sales (cash) + Stripe fees.
  const orders = await prisma.order.findMany({
    where: { createdAt: { gte: since }, status: { notIn: ["PENDING", "REFUNDED"] } },
    select: { totalCents: true, bucksAppliedCents: true, quantity: true, stripePaymentIntentId: true, stripeInvoiceId: true },
  });
  let clientRevenueCents = 0, clientLeadsSold = 0;
  const txns = new Map<string, number>();
  for (const o of orders) {
    const cash = Math.max(0, o.totalCents - o.bucksAppliedCents);
    clientRevenueCents += cash; clientLeadsSold += o.quantity;
    const tx = o.stripePaymentIntentId || o.stripeInvoiceId;
    if (tx && cash > 0) txns.set(tx, (txns.get(tx) ?? 0) + cash);
  }
  let stripeFeesCents = 0;
  for (const [, cash] of txns) stripeFeesCents += Math.round(cash * STRIPE_PCT) + STRIPE_FLAT_CENTS;

  // Paid + pending house-lead reimbursements in window (by paidAt / createdAt).
  let reimbursementCents = 0, reimbursementPending = 0, reimbursementPendingCents = 0;
  try {
    const paid = await prisma.houseLeadSettlement.aggregate({
      where: { status: "PAID", paidAt: { gte: since } },
      _sum: { amountCents: true },
    });
    reimbursementCents = paid._sum.amountCents ?? 0;
    const pend = await prisma.houseLeadSettlement.aggregate({
      where: { status: "PENDING" },
      _sum: { amountCents: true }, _count: { _all: true },
    });
    reimbursementPending = pend._count._all;
    reimbursementPendingCents = pend._sum.amountCents ?? 0;
  } catch {
    // Settlement table not migrated yet — treat as zero.
  }

  const netScenario2Cents = clientRevenueCents + reimbursementCents - adSpendCents - stripeFeesCents;
  const rev2 = clientRevenueCents + reimbursementCents;
  const netScenario1Cents = clientRevenueCents - adSpendCents - stripeFeesCents;
  return {
    range, sinceIso: since.toISOString(), untilIso: until.toISOString(),
    leadsGenerated, cplCents, adSpendCents, adSpendSource,
    clientRevenueCents, clientLeadsSold, stripeFeesCents,
    reimbursementCents, reimbursementPending, reimbursementPendingCents,
    netScenario2Cents, marginScenario2: rev2 > 0 ? netScenario2Cents / rev2 : null,
    netScenario1Cents, marginScenario1: clientRevenueCents > 0 ? netScenario1Cents / clientRevenueCents : null,
  };
}
