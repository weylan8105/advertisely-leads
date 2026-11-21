import { prisma } from "./prisma";
import { getHouseAccount } from "./house";
import {
  SHARED_POOL_ACCOUNTS,
  SHARED_POOL_CAMPAIGNS,
  cplFromInsights,
  combineInsights,
  poolSpendRow,
  sharedPoolOf,
  withoutClientStamp,
  type SharedPool,
} from "./sharedPool";

/**
 * What the Advertisely admins owe for the leads they take (owner request, Nov
 * 21 2026): the reverse of a client's ad-spend balance. Clients see how much
 * they have left; admins see how much they owe, so they don't take on more than
 * they can pay for.
 *
 * Leads: every lead the routing sends to an admin (the admin's round-robin
 * slot, into their CRM or their team Goldmine) since BALANCE_START. How many
 * arrive is still set the same way, by the admin's weekly lead target.
 *
 * Price: each lead is locked at its campaign's cost per lead on the day it was
 * delivered, averaged over the 14 days up to that day (owner: "the average of
 * the last 2 weeks"; a rolling 3-day window was tried for an hour on Nov 21
 * 2026 and the owner chose 14 days). Cost per lead = the pool's ad spend ÷ its leads, the same
 * spend rules shared leads use (lib/sharedPool.ts: every house campaign in the
 * pool's ad account, clients' own campaigns left out). At cost: no +20%, no 3%
 * card fee (admins pay by bank transfer) and no $20 minimum. A lead outside the
 * pools is priced at all pools together for that window.
 *
 * Two ways to pay, chosen on the owners' dashboard (owner, Nov 21 2026):
 *  - "advance": leads arrive with nothing paid up front and are added to the
 *    balance owed. This is how it worked before the choice existed.
 *  - "prepay": pay first, leads after. A lead only goes to an admin while the
 *    balance covers that lead's cost today; with less than that, the admins'
 *    turn in the rotation is skipped until a payment is recorded.
 * It is one balance either way; the mode only decides whether it may go below
 * zero.
 *
 * Paid = bank transfers recorded on the dashboard since BALANCE_START. The Nov
 * 9–12 lock-in quote ($5,385.60) was paid (owner, Nov 21) and is no longer shown.
 *
 * balance = paid − owed (negative = still owed)
 */

// Nov 13 2026 00:00 CST, the end of the lock-in quote. Routing to admins was
// paused Nov 13–18, so the first leads counted are the bank leads moved to the
// admin's Goldmine during that pause and the round-robin leads from Nov 18.
export const BALANCE_START = new Date("2026-11-13T06:00:00Z");
// Days that set a lead's price: the 14 up to and including its delivery day.
export const CPL_WINDOW_DAYS = 14;
export const LEAD_COST_PAYMENT_METHOD = "bank";
const TZ = "America/Chicago";

// Transfers that paid the Nov 9–12 lock-in quote, not this balance: the
// $5,385.60 recorded Nov 17 2026 (paid in full, owner, Nov 21).
const LOCKIN_QUOTE_PAYMENT_IDS = new Set(["cmwlg7hbj0001ju08brq9dj2i"]);

// LEAD_ASSIGNED bodies written when routing hands a lead to an admin (lib/house.ts).
const ADMIN_ROUTED = [
  "Routed to admin CRM%",
  "Routed to the admin's team Goldmine%",
  "Moved from the bank to the admin's team Goldmine%",
];

export interface LeadCostPayment {
  id: string;
  amountCents: number;
  method: string;
  note: string | null;
  at: string; // ISO
}

export interface LeadCostLine {
  key: SharedPool | "other";
  label: string;
  leads: number;
  owedCents: number;
}

export type LeadBillingMode = "advance" | "prepay";

export interface LeadCostLedger {
  userId: string;
  /** "advance" = leads first, pay after; "prepay" = pay first, leads only while the balance covers them. */
  mode: LeadBillingMode;
  /** What one more lead from each source would cost today. */
  nextPrices: { key: LeadCostLine["key"]; label: string; cents: number }[];
  /** A typical lead's cost: the last 7 days' average, else today's prices. */
  typicalCplCents: number;
  /** About how many more leads the balance covers at that cost. 0 when nothing is left. */
  leadsCovered: number;
  /** Prepay with too little left for even the cheapest lead: no leads go to admins. */
  onHold: boolean;
  startIso: string;
  nowIso: string;
  windowDays: number;
  /** "meta" when every price came from Meta; "fallback" when some used a fixed rate. */
  cplSource: "meta" | "fallback";

  totalLeads: number;
  owedCents: number;
  /** owed ÷ leads: the average cost per lead admins are paying. */
  avgCplCents: number | null;
  paidCents: number;
  balanceCents: number; // paid − owed (negative = still owed)
  stillOwedCents: number;

  lines: LeadCostLine[];
  days: { date: string; leads: number; owedCents: number }[];

  /** The admin's weekly lead target (rolling 7 days) and the leads in the last 7 days. */
  weeklyTarget: number | null;
  last7: { leads: number; owedCents: number };

  // Last completed Mon–Sun week, for the weekly pay reminder. `leads` stays 0
  // (no reminder) while nothing is owed.
  lastWeek: { startIso: string; endIso: string; leads: number; owedCents: number };

  settled: boolean;
  payments: LeadCostPayment[]; // counted toward the balance
  earlierPayments: LeadCostPayment[]; // the lock-in quote payment and anything before BALANCE_START, not applied
}

// ─── Dates ───────────────────────────────────────────────────────────────────

export const ymdChicago = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Previous completed Monday–Sunday week in America/Chicago, as UTC instants (CST). */
function lastWeekRange(now: Date): { start: Date; end: Date } {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(now);
  const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
  const todayMidnightUtc = new Date(`${ymdChicago(now)}T06:00:00Z`);
  const thisMonday = new Date(todayMidnightUtc.getTime() - ((idx + 6) % 7) * 86_400_000);
  return { start: new Date(thisMonday.getTime() - 7 * 86_400_000), end: thisMonday };
}

// ─── Cost per lead by pool and day ───────────────────────────────────────────

type Insights = { spend?: string; actions?: { action_type: string; value: string }[] };
type DailyRow = Insights & { campaign_id?: string; campaign_name?: string; date_start?: string };

/** pool → day → that pool's spend/leads row; plus arrived leads per pool per day. */
export interface DailyCosts {
  insights: Map<SharedPool, Map<string, Insights>>;
  arrived: Map<SharedPool, Map<string, number>>;
}

/**
 * A pool's cost per lead over the `windowDays` days ending `ymd` (inclusive), or
 * null when that window has no spend or no leads. Pass several pools to price
 * them together.
 */
export function windowCplCents(costs: DailyCosts, pools: SharedPool[], ymd: string, windowDays: number): number | null {
  const rows: Insights[] = [];
  let arrived = 0;
  for (const pool of pools) {
    for (let i = 0; i < windowDays; i++) {
      const day = addDaysYmd(ymd, -i);
      const row = costs.insights.get(pool)?.get(day);
      if (row) rows.push(row);
      arrived += costs.arrived.get(pool)?.get(day) ?? 0;
    }
  }
  return cplFromInsights(combineInsights(rows) ?? (rows.length ? rows[0] : undefined), arrived || null);
}

/**
 * The price of a lead delivered on `ymd`: the pool's cost per lead over the 14
 * days up to and including that day. Null when that window has no spend or no
 * leads (caller uses the fallback).
 */
export function leadCplCents(costs: DailyCosts, pools: SharedPool[], ymd: string): number | null {
  return windowCplCents(costs, pools, ymd, CPL_WINDOW_DAYS);
}

// ─── Advance or prepay ───────────────────────────────────────────────────────

// Kept in a DistributionCursor key/value row, so no new column is needed.
const BILLING_MODE_KEY = "leadcost:billing-mode";

export async function getLeadBillingMode(): Promise<LeadBillingMode> {
  if (!prisma) return "advance";
  const row = await prisma.distributionCursor.findUnique({ where: { id: BILLING_MODE_KEY } });
  return row?.lastRecipientId === "prepay" ? "prepay" : "advance";
}

export async function setLeadBillingMode(mode: LeadBillingMode): Promise<void> {
  if (!prisma) return;
  await prisma.distributionCursor.upsert({
    where: { id: BILLING_MODE_KEY },
    update: { lastRecipientId: mode },
    create: { id: BILLING_MODE_KEY, lastRecipientId: mode },
  });
}

/** Prepay only: does the balance cover one more lead at this price? Advance always does. */
export function coversLead(mode: LeadBillingMode, balanceCents: number, priceCents: number): boolean {
  return mode !== "prepay" || balanceCents >= priceCents;
}

/**
 * May the routing hand an admin one more lead from this pool right now? Always
 * yes on "advance". On "prepay" only while the balance covers that lead's cost
 * today; if the balance can't be read the lead is held, never advanced.
 */
export async function adminLeadFunded(pool: SharedPool | null, now = new Date()): Promise<boolean> {
  try {
    if ((await getLeadBillingMode()) !== "prepay") return true;
    const ledger = await buildLeadCostLedger(now);
    if (!ledger) return false;
    const price = ledger.nextPrices.find((p) => p.key === (pool ?? "other"))?.cents;
    return price != null && coversLead("prepay", ledger.balanceCents, price);
  } catch (e) {
    console.warn("[lead-cost] prepay check failed; holding the admin turn", e);
    return false;
  }
}

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const READ_TOKEN = process.env.META_ADS_ACCESS_TOKEN || process.env.META_ADS_MANAGE_TOKEN;
const POOLS = Object.keys(SHARED_POOL_ACCOUNTS) as SharedPool[];

async function accountDailyRows(account: string, since: string, until: string): Promise<DailyRow[] | null> {
  if (!READ_TOKEN) return null;
  const range = encodeURIComponent(JSON.stringify({ since, until }));
  let next: string | null =
    `${GRAPH}/act_${account}/insights?level=campaign&time_increment=1&fields=campaign_id,campaign_name,spend,actions&time_range=${range}&limit=500&access_token=${encodeURIComponent(READ_TOKEN)}`;
  const out: DailyRow[] = [];
  for (let page = 0; next && page < 20; page++) {
    const res: Response = await fetch(next, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.error) {
      console.warn("[lead-cost] daily insights failed", account, json?.error?.message ?? res.status);
      return null;
    }
    out.push(...(json.data ?? []));
    next = json.paging?.next ?? null;
  }
  return out;
}

async function clientCampaignIds(): Promise<Set<string>> {
  if (!prisma) return new Set();
  const users = await prisma.user.findMany({ where: { adCampaignIds: { isEmpty: false } }, select: { adCampaignIds: true } });
  return new Set(users.flatMap((u) => u.adCampaignIds ?? []));
}

async function loadDailyCosts(since: string, until: string, now: Date): Promise<DailyCosts> {
  const insights = new Map<SharedPool, Map<string, Insights>>();
  const arrived = new Map<SharedPool, Map<string, number>>();
  const clientIds = await clientCampaignIds().catch(() => new Set<string>());

  const accounts = Array.from(new Set(POOLS.map((p) => SHARED_POOL_ACCOUNTS[p].account)));
  const rowsByAccount = new Map(
    await Promise.all(accounts.map(async (a) => [a, await accountDailyRows(a, since, until).catch(() => null)] as const)),
  );
  for (const pool of POOLS) {
    const rows = rowsByAccount.get(SHARED_POOL_ACCOUNTS[pool].account);
    if (!rows) continue;
    const byDay = new Map<string, DailyRow[]>();
    for (const r of rows) {
      const day = r.date_start ?? "";
      if (!day) continue;
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(r);
    }
    const perDay = new Map<string, Insights>();
    for (const [day, dayRows] of byDay) {
      const row = poolSpendRow(pool, dayRows, clientIds);
      if (row) perDay.set(day, row);
    }
    insights.set(pool, perDay);
  }

  if (prisma) {
    const leads = await prisma.lead.findMany({
      where: { receivedAt: { gte: new Date(`${since}T06:00:00Z`), lt: now }, trashedAt: null },
      select: { receivedAt: true, source: true, rawFormData: true, campaignName: true, packageId: true },
    });
    for (const l of leads) {
      const pool = sharedPoolOf({ ...l, rawFormData: withoutClientStamp(l.rawFormData) });
      if (!pool) continue;
      const day = ymdChicago(l.receivedAt);
      if (!arrived.has(pool)) arrived.set(pool, new Map());
      const m = arrived.get(pool)!;
      m.set(day, (m.get(day) ?? 0) + 1);
    }
  }
  return { insights, arrived };
}

// ─── The ledger ──────────────────────────────────────────────────────────────

const LINE_LABEL: Record<LeadCostLine["key"], string> = {
  abca: SHARED_POOL_CAMPAIGNS.abca.label,
  ew: SHARED_POOL_CAMPAIGNS.ew.label,
  ewws: SHARED_POOL_CAMPAIGNS.ewws.label,
  nurse: "Nurses",
  other: "Other sources",
};

// Only the Meta prices are cached. Leads, payments and the mode are read every
// time, so the prepay check always sees the lead that was just delivered.
let costCache: { at: number; key: string; value: DailyCosts } | null = null;
const CACHE_MS = 5 * 60_000;

/** Forget the cached prices. */
export function forgetLeadCostLedger() {
  costCache = null;
}

async function dailyCosts(since: string, until: string, now: Date, fresh: boolean): Promise<DailyCosts> {
  const key = `${since}|${until}`;
  if (!fresh && costCache && costCache.key === key && Date.now() - costCache.at < CACHE_MS) return costCache.value;
  const value = await loadDailyCosts(since, until, now);
  costCache = { at: Date.now(), key, value };
  return value;
}

export async function buildLeadCostLedger(now = new Date(), opts: { fresh?: boolean } = {}): Promise<LeadCostLedger | null> {
  if (!prisma) return null;
  const house = await getHouseAccount();
  if (!house) return null;

  // Leads routed to an admin, first routing only.
  const routed = await prisma.$queryRaw<
    { leadId: string; at: Date; source: string | null; rawFormData: unknown; campaignName: string | null; packageId: string | null }[]
  >`
    SELECT f."leadId", f.at, l.source, l."rawFormData", l."campaignName", l."packageId"
    FROM (
      SELECT DISTINCT ON (a."leadId") a."leadId", a."createdAt" AS at
      FROM "LeadActivity" a
      WHERE a.type = 'LEAD_ASSIGNED' AND a."createdAt" >= ${BALANCE_START} AND a.body LIKE ANY(${ADMIN_ROUTED})
      ORDER BY a."leadId", a."createdAt" ASC
    ) f
    JOIN "Lead" l ON l.id = f."leadId"
    WHERE l."trashedAt" IS NULL`;

  const firstDay = routed.reduce((min, r) => {
    const d = ymdChicago(r.at);
    return d < min ? d : min;
  }, ymdChicago(now));
  const today = ymdChicago(now);
  const costs = await dailyCosts(addDaysYmd(firstDay, -(CPL_WINDOW_DAYS - 1)), today, now, !!opts.fresh);

  let usedFallback = false;
  const priceCache = new Map<string, number>();
  const price = (pool: SharedPool | null, day: string): number => {
    const key = `${pool ?? "other"}|${day}`;
    const hit = priceCache.get(key);
    if (hit != null) return hit;
    let cents = leadCplCents(costs, pool ? [pool] : POOLS, day);
    if (cents == null) {
      usedFallback = true;
      cents = SHARED_POOL_CAMPAIGNS[pool ?? "ew"].fallbackCplCents;
    }
    priceCache.set(key, cents);
    return cents;
  };

  const lines = new Map<LeadCostLine["key"], LeadCostLine>();
  const days = new Map<string, { leads: number; owedCents: number }>();
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const { start: lwStart, end: lwEnd } = lastWeekRange(now);
  let owedCents = 0;
  const last7 = { leads: 0, owedCents: 0 };
  let lastWeekLeads = 0;
  for (const r of routed) {
    const pool = sharedPoolOf({ ...r, rawFormData: withoutClientStamp(r.rawFormData) });
    const day = ymdChicago(r.at);
    const cents = price(pool, day);
    owedCents += cents;
    const key = pool ?? "other";
    const line = lines.get(key) ?? { key, label: LINE_LABEL[key], leads: 0, owedCents: 0 };
    line.leads++;
    line.owedCents += cents;
    lines.set(key, line);
    const d = days.get(day) ?? { leads: 0, owedCents: 0 };
    d.leads++;
    d.owedCents += cents;
    days.set(day, d);
    if (r.at.getTime() >= weekAgo) {
      last7.leads++;
      last7.owedCents += cents;
    }
    if (r.at >= lwStart && r.at < lwEnd) lastWeekLeads++;
  }

  const [mode, payRows, admin] = await Promise.all([
    getLeadBillingMode(),
    prisma.adSpendPayment.findMany({
      where: { userId: house.userId, method: LEAD_COST_PAYMENT_METHOD },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    prisma.user.findUnique({ where: { id: house.userId }, select: { weeklyLeadTarget: true } }),
  ]);
  const toPayment = (p: (typeof payRows)[number]): LeadCostPayment => ({
    id: p.id,
    amountCents: p.amountCents,
    method: p.method,
    note: p.note,
    at: p.receivedAt.toISOString(),
  });
  const applies = (p: (typeof payRows)[number]) => p.receivedAt >= BALANCE_START && !LOCKIN_QUOTE_PAYMENT_IDS.has(p.id);
  const counted = payRows.filter(applies);
  const earlier = payRows.filter((p) => !applies(p));
  const paidCents = counted.reduce((s, p) => s + p.amountCents, 0);
  const stillOwedCents = Math.max(0, owedCents - paidCents);
  const balanceCents = paidCents - owedCents;

  // What one more lead would cost today, per source; and how far the balance goes.
  // (A source with no recent leads prices at its standard rate here; that isn't a
  // failed Meta read, so it doesn't count toward `cplSource`.)
  const fallbackOnLeads = usedFallback;
  const nextPrices = ([...POOLS, null] as (SharedPool | null)[]).map((pool) => {
    const key: LeadCostLine["key"] = pool ?? "other";
    return { key, label: LINE_LABEL[key], cents: price(pool, today) };
  });
  const cheapest = Math.min(...nextPrices.map((p) => p.cents));
  // Typical cost of a lead: the last 7 days' leads if there were any, else today's prices.
  const typical = last7.leads > 0 ? Math.round(last7.owedCents / last7.leads) : Math.round(nextPrices.reduce((s, p) => s + p.cents, 0) / nextPrices.length);
  const leadsCovered = balanceCents > 0 && typical > 0 ? Math.floor(balanceCents / typical) : 0;

  const value: LeadCostLedger = {
    userId: house.userId,
    mode,
    nextPrices,
    typicalCplCents: typical,
    leadsCovered,
    onHold: mode === "prepay" && balanceCents < cheapest,
    startIso: BALANCE_START.toISOString(),
    nowIso: now.toISOString(),
    windowDays: CPL_WINDOW_DAYS,
    cplSource: fallbackOnLeads ? "fallback" : "meta",
    totalLeads: routed.length,
    owedCents,
    avgCplCents: routed.length ? Math.round(owedCents / routed.length) : null,
    paidCents,
    balanceCents,
    stillOwedCents,
    lines: Array.from(lines.values()).sort((a, b) => b.leads - a.leads),
    days: Array.from(days, ([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
    weeklyTarget: admin?.weeklyLeadTarget ?? null,
    last7,
    lastWeek: {
      startIso: lwStart.toISOString(),
      endIso: lwEnd.toISOString(),
      leads: stillOwedCents > 0 ? lastWeekLeads : 0,
      owedCents: stillOwedCents,
    },
    settled: stillOwedCents === 0,
    payments: counted.map(toPayment),
    earlierPayments: earlier.map(toPayment),
  };
  return value;
}
