import { prisma } from "./prisma";
import { getBlendedAdSpend7d } from "./metaInsights";
import { getHouseAccount } from "./house";

/**
 * Ryan's lead-cost ledger — what Enhanced Wealth owes Advertisely for the leads
 * it's fronting, against what Ryan has paid back.
 *
 * Ryan fronts the ad cost for every fresh lead Advertisely delivers to him (his
 * house CRM) or to one of his team's agents during (and after) the Enhanced
 * Wealth lock-in. Each such lead costs the current blended cost-per-lead (ad
 * spend across both ad accounts ÷ leads generated) — the same "at cost" number
 * the weekly house-lead invoice uses. Leads sold to outside buyers, and leads
 * that belong to other advertiser clients' own campaigns, are NOT his cost and
 * are excluded.
 *
 * owed  = (house + team leads since the lock-in start) × CPL
 * paid  = the bank transfers Ryan records (AdSpendPayment)
 * balance = paid − owed  (may go NEGATIVE — Ryan's account is the only one
 *           allowed to; a negative balance means he still owes that much)
 */

// The lock-in started Nov 9 2026 00:00 America/Chicago (CST) and the surge
// auto-reverts Nov 12 00:00 CST. The ledger keeps accruing after that — the
// lock-in flag only changes the panel's title.
export const LEDGER_START = new Date("2026-11-09T06:00:00Z");
export const LOCKIN_END = new Date("2026-11-12T06:00:00Z");

export const LEAD_COST_PAYMENT_METHOD = "bank";

// The lead-cost reimbursement rate Ryan is billed per lead, stored on its own
// (a DistributionCursor KV row) and kept SEPARATE from the global pricing CPL
// (User.manualCplCents), which drives the marketplace fresh-lead price floor —
// so setting Ryan's pay-back rate never moves lead sale prices.
const LEAD_COST_CPL_KEY = "leadcost:cpl-cents";

export async function getLeadCostCplCents(): Promise<number | null> {
  if (!prisma) return null;
  const row = await prisma.distributionCursor.findUnique({ where: { id: LEAD_COST_CPL_KEY } });
  const n = parseInt(row?.lastRecipientId ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function setLeadCostCplCents(cents: number | null): Promise<void> {
  if (!prisma) return;
  const val = cents == null ? "" : String(Math.round(cents));
  await prisma.distributionCursor.upsert({
    where: { id: LEAD_COST_CPL_KEY },
    update: { lastRecipientId: val },
    create: { id: LEAD_COST_CPL_KEY, lastRecipientId: val },
  });
}

export interface LeadCostTeamLine {
  userId: string;
  name: string;
  leads: number;
}

export interface LeadCostPayment {
  id: string;
  amountCents: number;
  method: string;
  note: string | null;
  at: string; // ISO
}

export interface LeadCostLedger {
  userId: string;
  lockInActive: boolean;
  ledgerStartIso: string;
  lockInEndIso: string;
  nowIso: string;

  cplCents: number | null;
  cplSource: "meta" | "manual" | "none";

  leadsToHouse: number; // delivered to Ryan's own CRM
  leadsToTeam: number; // delivered to his agents (not sold to buyers)
  totalLeads: number;
  team: LeadCostTeamLine[];

  owedCents: number; // totalLeads × CPL (0 when CPL unknown)
  paidCents: number;
  balanceCents: number; // paid − owed (negative = still owes)

  // Last completed Mon–Sun week, for the "pay for last week" reminder.
  lastWeek: {
    startIso: string;
    endIso: string;
    leads: number;
    owedCents: number;
  };

  payments: LeadCostPayment[];
}

/**
 * The per-lead rate Ryan is billed. The live blended ad CPL (last-7d ad spend
 * across both accounts ÷ leads generated) wins whenever Meta ad spend can be
 * read, so the average tracks itself. Until the Meta ads env vars are set, the
 * stored lead-cost rate (the KV) stands in. Never the global pricing CPL — that
 * would move sale prices.
 */
export async function resolveCplCents(): Promise<{ cplCents: number | null; cplSource: LeadCostLedger["cplSource"] }> {
  if (!prisma) return { cplCents: null, cplSource: "none" };
  const spend = await getBlendedAdSpend7d().catch(() => null);
  if (spend?.configured && spend.spendCents > 0) {
    const leads7d = await prisma.lead.count({
      where: { receivedAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, trashedAt: null },
    });
    if (leads7d > 0) return { cplCents: Math.round(spend.spendCents / leads7d), cplSource: "meta" };
  }
  const stored = await getLeadCostCplCents();
  return stored != null ? { cplCents: stored, cplSource: "manual" } : { cplCents: null, cplSource: "none" };
}

/** House + team leads (delivered, not sold to outside buyers) received in a window. */
async function countFrontedLeads(houseUserId: string, since: Date, until: Date) {
  if (!prisma) return { house: 0, team: 0, teamLines: [] as LeadCostTeamLine[] };
  const base = {
    receivedAt: { gte: since, lt: until },
    trashedAt: null,
    orderId: null, // exclude leads sold to outside buyers — those aren't Ryan's cost
    assignedUserId: { not: null },
  } as const;

  const house = await prisma.lead.count({ where: { ...base, assignedUserId: houseUserId } });

  const grouped = await prisma.lead.groupBy({
    by: ["assignedUserId"],
    // Other advertisers (clients running their own campaign) pay for their own
    // leads, so those are never part of what Ryan fronts.
    where: { ...base, NOT: { assignedUserId: houseUserId }, assignedUser: { isAdvertiser: false } },
    _count: { _all: true },
  });
  const team = grouped.reduce((s, g) => s + g._count._all, 0);

  const ids = grouped.map((g) => g.assignedUserId).filter((x): x is string => !!x);
  const names = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = new Map(names.map((u) => [u.id, u.name ?? u.email ?? "—"]));
  const teamLines: LeadCostTeamLine[] = grouped
    .map((g) => ({ userId: g.assignedUserId as string, name: nameOf.get(g.assignedUserId as string) ?? "—", leads: g._count._all }))
    .sort((a, b) => b.leads - a.leads);

  return { house, team, teamLines };
}

/** Previous completed Monday–Sunday week in America/Chicago, as UTC instants. */
function lastWeekRange(now: Date): { start: Date; end: Date } {
  // Day-of-week in Chicago.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(now);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts);
  // Chicago midnight today, expressed in UTC (CST = UTC-6; after DST ended Nov 1).
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const todayMidnightUtc = new Date(`${ymd}T06:00:00Z`);
  const daysSinceMonday = (idx + 6) % 7; // Mon→0, Sun→6
  const thisMonday = new Date(todayMidnightUtc.getTime() - daysSinceMonday * 86_400_000);
  const start = new Date(thisMonday.getTime() - 7 * 86_400_000); // last Monday
  const end = thisMonday; // last Sunday midnight = this Monday 00:00
  return { start, end };
}

export async function buildLeadCostLedger(now = new Date()): Promise<LeadCostLedger | null> {
  if (!prisma) return null;
  const house = await getHouseAccount();
  if (!house) return null;

  const { cplCents, cplSource } = await resolveCplCents();

  const { house: leadsToHouse, team: leadsToTeam, teamLines } = await countFrontedLeads(house.userId, LEDGER_START, now);
  const totalLeads = leadsToHouse + leadsToTeam;
  const owedCents = cplCents != null ? totalLeads * cplCents : 0;

  const payRows = await prisma.adSpendPayment.findMany({
    where: { userId: house.userId },
    orderBy: { receivedAt: "desc" },
    take: 50,
  });
  const paidCents = payRows.reduce((s, p) => s + p.amountCents, 0);

  const { start, end } = lastWeekRange(now);
  const lw = await countFrontedLeads(house.userId, start, end);
  const lwLeads = lw.house + lw.team;

  return {
    userId: house.userId,
    lockInActive: now.getTime() < LOCKIN_END.getTime(),
    ledgerStartIso: LEDGER_START.toISOString(),
    lockInEndIso: LOCKIN_END.toISOString(),
    nowIso: now.toISOString(),
    cplCents,
    cplSource,
    leadsToHouse,
    leadsToTeam,
    totalLeads,
    team: teamLines,
    owedCents,
    paidCents,
    balanceCents: paidCents - owedCents,
    lastWeek: {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      leads: lwLeads,
      owedCents: cplCents != null ? lwLeads * cplCents : 0,
    },
    payments: payRows.map((p) => ({ id: p.id, amountCents: p.amountCents, method: p.method, note: p.note, at: p.receivedAt.toISOString() })),
  };
}
