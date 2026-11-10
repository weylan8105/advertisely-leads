import { prisma } from "./prisma";
import { isClientCampaign } from "./metaInsights";
import { getHouseAccount } from "./house";

/**
 * Ryan's lead-cost ledger — what Enhanced Wealth owes Advertisely for the leads
 * it's fronting, against what Ryan has paid back.
 *
 * Ryan fronts the ad cost for every fresh lead Advertisely delivers to him (his
 * house CRM) or to one of his team's agents during (and after) the Enhanced
 * Wealth lock-in. Each such lead costs the average cost per lead: ad spend on
 * our own campaigns since the lock-in began ÷ the leads those campaigns
 * produced, the same "ad spend ÷ leads" every advertiser's panel shows. Leads
 * sold to outside buyers, and leads
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
  // Behind a live average: ad spend on our own campaigns since the lock-in
  // began, and the leads that spend produced. Null when Meta can't be read.
  adSpendCents: number | null;
  leadsGenerated: number | null;

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

// ─── Average cost per lead (ad spend ÷ leads) ────────────────────────────────

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
// Read-only use of whichever ads token production has. Deliberately not tied to
// META_ADS_ACCESS_TOKEN alone: setting that one also switches on the CPL price
// floor and the house-lead invoice amounts.
const ADS_TOKEN = process.env.META_ADS_ACCESS_TOKEN || process.env.META_ADS_MANAGE_TOKEN;
const LEDGER_START_YMD = "2026-11-09";
const EWWS_CAMPAIGN_PREFIX = "EWWS";

// The ad accounts our own campaigns run in. Enhanced Wealth and ABCA are the two
// the rest of the app reads; the Essential Workers account is read when the
// token can see it, and its leads are left out of the average when it can't.
const HOUSE_AD_ACCOUNTS: { key: "ew" | "abca" | "ewws"; id: string; tz: string; required: boolean }[] = [
  { key: "ew", id: process.env.ENHANCED_WEALTH_AD_ACCOUNT_ID || "2254810101392917", tz: "America/Los_Angeles", required: true },
  { key: "abca", id: process.env.ABCA_AD_ACCOUNT_ID || "2126340781245705", tz: "America/Chicago", required: true },
  { key: "ewws", id: process.env.EWWS_AD_ACCOUNT_ID || "1270766111922960", tz: "America/Los_Angeles", required: false },
];

const ymdIn = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** One account's spend since the lock-in began, client campaigns left out. Throws when Meta won't answer. */
async function accountSpendCents(accountId: string, tz: string, now: Date): Promise<number> {
  const account = `act_${accountId.replace(/^act_/, "").replace(/\D/g, "")}`;
  const until = ymdIn(now, tz);
  const range = encodeURIComponent(JSON.stringify({ since: LEDGER_START_YMD, until: until < LEDGER_START_YMD ? LEDGER_START_YMD : until }));
  let next: string | null =
    `${GRAPH}/${account}/insights?level=campaign&fields=campaign_name,spend&time_range=${range}&limit=200&access_token=${encodeURIComponent(ADS_TOKEN!)}`;
  let cents = 0;
  for (let page = 0; next && page < 10; page++) {
    const res: Response = await fetch(next, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) throw new Error(json?.error?.message ?? `Graph API ${res.status}`);
    for (const row of json.data ?? []) {
      if (isClientCampaign(row.campaign_name)) continue; // clients pay for their own campaigns
      cents += Math.round((parseFloat(String(row.spend ?? "0")) || 0) * 100);
    }
    next = json.paging?.next ?? null;
  }
  return cents;
}

interface HouseAdSpend {
  spendCents: number;
  ewwsRead: boolean;
}

let houseSpendCache: { at: number; value: HouseAdSpend | null } | null = null;
const HOUSE_SPEND_TTL_MS = 5 * 60_000;

/** Ad spend on our own campaigns since the lock-in began. Null when it can't be read. Five-minute cache. */
async function houseAdSpend(now: Date): Promise<HouseAdSpend | null> {
  if (!ADS_TOKEN) return null;
  if (houseSpendCache && Date.now() - houseSpendCache.at < HOUSE_SPEND_TTL_MS) return houseSpendCache.value;
  const results = await Promise.all(
    HOUSE_AD_ACCOUNTS.map((a) =>
      accountSpendCents(a.id, a.tz, now).then(
        (cents) => ({ a, cents, ok: true as const }),
        (err) => {
          console.warn(`[lead-cost] ad spend for ${a.key}: ${(err as Error).message}`);
          return { a, cents: 0, ok: false as const };
        },
      ),
    ),
  );
  const value: HouseAdSpend | null = results.some((r) => r.a.required && !r.ok)
    ? null
    : {
        spendCents: results.reduce((sum, r) => sum + r.cents, 0),
        ewwsRead: results.find((r) => r.a.key === "ewws")?.ok ?? false,
      };
  houseSpendCache = { at: Date.now(), value };
  return value;
}

/**
 * The per-lead rate Ryan is billed: the average cost per lead, worked out the
 * way every advertiser's is (ad spend ÷ leads). Spend is what our own campaigns
 * have spent since the lock-in began; leads are the ones those campaigns
 * produced in that time, whoever they went to. When Meta can't be read the
 * stored lead-cost rate stands in. Never the global pricing CPL, which would
 * move sale prices.
 */
export async function resolveCplCents(
  houseUserId: string,
  now = new Date(),
): Promise<Pick<LeadCostLedger, "cplCents" | "cplSource" | "adSpendCents" | "leadsGenerated">> {
  if (!prisma) return { cplCents: null, cplSource: "none", adSpendCents: null, leadsGenerated: null };
  const spend = await houseAdSpend(now).catch(() => null);
  if (spend && spend.spendCents > 0) {
    const [row] = await prisma.$queryRaw<{ n: number; ewws: number }[]>`
      SELECT COUNT(*)::int AS n,
             COALESCE(SUM(CASE WHEN COALESCE(l."campaignName", l."utmCampaign", '') ILIKE ${EWWS_CAMPAIGN_PREFIX + "%"} THEN 1 ELSE 0 END), 0)::int AS ewws
      FROM "Lead" l
      LEFT JOIN "User" u ON u.id = l."assignedUserId"
      WHERE l."receivedAt" >= ${LEDGER_START} AND l."receivedAt" < ${now}
        AND l."trashedAt" IS NULL
        AND COALESCE(l."campaignName", '') NOT LIKE 'Advertisely Advertiser%'
        AND COALESCE(l."utmCampaign", '') NOT LIKE 'Advertisely Advertiser%'
        AND NOT (COALESCE(u."isAdvertiser", false) AND u.id <> ${houseUserId})`;
    const leads = (row?.n ?? 0) - (spend.ewwsRead ? 0 : row?.ewws ?? 0);
    if (leads > 0) {
      return { cplCents: Math.round(spend.spendCents / leads), cplSource: "meta", adSpendCents: spend.spendCents, leadsGenerated: leads };
    }
  }
  const stored = await getLeadCostCplCents();
  return stored != null
    ? { cplCents: stored, cplSource: "manual", adSpendCents: null, leadsGenerated: null }
    : { cplCents: null, cplSource: "none", adSpendCents: null, leadsGenerated: null };
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

  const { cplCents, cplSource, adSpendCents, leadsGenerated } = await resolveCplCents(house.userId, now);

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
    adSpendCents,
    leadsGenerated,
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
