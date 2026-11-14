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
 * Since Nov 13 2026 the bill is a FIXED QUOTE (LOCKIN_QUOTE below) instead of a
 * live count, shown on Ryan's dashboard until it is paid:
 *
 * owed  = quote leads × quote cost per lead
 * paid  = the bank transfers recorded after the lock-in closed (AdSpendPayment)
 * balance = paid − owed  (may go NEGATIVE — Ryan's account is the only one
 *           allowed to; a negative balance means he still owes that much)
 */

// The lock-in started Nov 9 2026 00:00 America/Chicago (CST) and the surge
// auto-reverted Nov 12 00:00 CST.
export const LEDGER_START = new Date("2026-11-09T06:00:00Z");
export const LOCKIN_END = new Date("2026-11-12T06:00:00Z");

export interface LeadCostQuote {
  fromIso: string;
  toIso: string; // exclusive
  /** Leads billed: `sentLeads` − `clientLeads`. */
  leads: number;
  /** Leads that were first sent to Ryan. */
  sentLeads: number;
  /** Of those, the ones later handed to clients, who pay for them instead. */
  clientLeads: number;
  clients: { name: string; leads: number }[];
  cplCents: number;
  totalCents: number;
  adSpendCents: number;
  leadsGenerated: number;
  /** Where the leads came from. Adds up to `sentLeads`. */
  lines: { label: string; leads: number }[];
  /** Leads per day (America/Chicago). Adds up to `sentLeads`. */
  days: { date: string; leads: number }[];
  /** Only transfers recorded from this moment on count toward the quote. */
  paymentsFromIso: string;
  /** Shown beside any transfer recorded before `paymentsFromIso`. */
  earlierPaymentsNote: string;
}

/**
 * The lock-in quote (owner request, Nov 13 2026): one fixed bill for every lead
 * that was FIRST sent to Ryan from the start of the lock-in until routing to
 * him was switched off late on Nov 12 (lib/housePause.ts). A lead counts if it
 * reached him first, whether it then stayed in his pipeline, went to the
 * Goldmine or was passed to a teammate.
 *
 * One exception (owner, same day): leads later handed on to clients are the
 * clients' cost, not his. 22 were redistributed out of his pipeline on Nov 13
 * while he was away, to buyers' paid orders and to advertisers' ad-spend
 * balances, so those come off: 214 − 22 = 192 billed. If more of these leads
 * are handed to clients later, lower `QUOTE_CLIENT_LEADS` and `clients` again.
 *
 * Frozen on purpose. The live count this replaces read "who holds the lead
 * now", which stopped being true once leads were moved out of his pipeline and
 * guest agents began taking turns. Counted on Nov 13 from each lead's first
 * LEAD_ASSIGNED activity: 215 leads reached him first; one was a bad lead that
 * was swapped for a replacement, which leaves 214 before the client leads.
 *
 * Cost per lead = ad spend on our own campaigns Nov 9–12 ÷ the leads those
 * campaigns produced in that time = $7,489.28 ÷ 256 = $29.26.
 *   Enhanced Wealth    $3,261.21  (Blue Collar ER)
 *   ABCA               $1,931.10  (Team Use $1,706.45 + Text message Test $224.65)
 *   Essential Workers  $2,296.97  (Nurses $1,166.59 + Blue Collar $1,130.38)
 * "Advertisely Advertiser - …" campaigns belong to clients and are left out of
 * both the spend and the lead count.
 *
 * Payments: the $2,300.32 recorded on Nov 10 answered that week's pop-up, which
 * billed the week BEFORE the lock-in (Nov 2–8: 88 leads × $26.14). It is shown
 * as an earlier payment and not applied here. To credit it to this quote
 * instead, set `paymentsFromIso` to `fromIso`.
 */
const QUOTE_SENT_LEADS = 214;
const QUOTE_CLIENT_LEADS = 22;
const QUOTE_LEADS = QUOTE_SENT_LEADS - QUOTE_CLIENT_LEADS;
const QUOTE_CPL_CENTS = 2926;
export const LOCKIN_QUOTE: LeadCostQuote = {
  fromIso: LEDGER_START.toISOString(),
  toIso: "2026-11-13T06:00:00.000Z",
  leads: QUOTE_LEADS,
  sentLeads: QUOTE_SENT_LEADS,
  clientLeads: QUOTE_CLIENT_LEADS,
  clients: [
    { name: "Jace Jensen", leads: 5 },
    { name: "Angelo Rodriguez", leads: 4 },
    { name: "Luke Scheffers", leads: 4 },
    { name: "Mario Alvarado", leads: 4 },
    { name: "Kyle Vietzke", leads: 3 },
    { name: "David Layton", leads: 2 },
  ],
  cplCents: QUOTE_CPL_CENTS,
  totalCents: QUOTE_LEADS * QUOTE_CPL_CENTS,
  adSpendCents: 748_928,
  leadsGenerated: 256,
  lines: [
    { label: "Enhanced Wealth Blue Collar page", leads: 78 },
    { label: "Essential Workers forms (nurses and blue collar)", leads: 77 },
    { label: "ABCA, lock-in boost", leads: 37 },
    { label: "ABCA, your turns in the rotation", leads: 21 },
    { label: "Replacement for a bad lead (the bad one isn't charged)", leads: 1 },
  ],
  days: [
    { date: "2026-11-09", leads: 58 },
    { date: "2026-11-10", leads: 56 },
    { date: "2026-11-11", leads: 67 },
    { date: "2026-11-12", leads: 33 },
  ],
  paymentsFromIso: "2026-11-13T06:00:00.000Z",
  earlierPaymentsNote: "Paid for the week before the lock-in (Nov 2–8), so it isn't part of this quote.",
};

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

  // Last completed Mon–Sun week, for the weekly pay reminder. `leads` stays 0
  // (no reminder) until the lock-in week is a completed week and while nothing
  // is owed; `owedCents` is what is still owed on the quote.
  lastWeek: {
    startIso: string;
    endIso: string;
    leads: number;
    owedCents: number;
  };

  /** The fixed lock-in quote everything above is taken from. */
  quote: LeadCostQuote;
  /** Paid in full: the dashboard panel and the reminder go away. */
  settled: boolean;

  payments: LeadCostPayment[]; // counted toward the quote
  earlierPayments: LeadCostPayment[]; // recorded before the quote, not applied
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

  const quote = LOCKIN_QUOTE;
  const owedCents = quote.totalCents;

  const payRows = await prisma.adSpendPayment.findMany({
    where: { userId: house.userId },
    orderBy: { receivedAt: "desc" },
    take: 50,
  });
  const toPayment = (p: (typeof payRows)[number]): LeadCostPayment => ({
    id: p.id,
    amountCents: p.amountCents,
    method: p.method,
    note: p.note,
    at: p.receivedAt.toISOString(),
  });
  const countsFrom = new Date(quote.paymentsFromIso).getTime();
  const counted = payRows.filter((p) => p.receivedAt.getTime() >= countsFrom);
  const earlier = payRows.filter((p) => p.receivedAt.getTime() < countsFrom);
  const paidCents = counted.reduce((s, p) => s + p.amountCents, 0);
  const stillOwedCents = Math.max(0, owedCents - paidCents);

  // The weekly pop-up starts once the lock-in week is a completed week.
  const { start, end } = lastWeekRange(now);
  const reminderDue = end.getTime() >= new Date(quote.toIso).getTime() && stillOwedCents > 0;

  return {
    userId: house.userId,
    lockInActive: false,
    ledgerStartIso: quote.fromIso,
    lockInEndIso: LOCKIN_END.toISOString(),
    nowIso: now.toISOString(),
    cplCents: quote.cplCents,
    cplSource: "meta",
    adSpendCents: quote.adSpendCents,
    leadsGenerated: quote.leadsGenerated,
    leadsToHouse: quote.leads,
    leadsToTeam: 0,
    totalLeads: quote.leads,
    team: [],
    owedCents,
    paidCents,
    balanceCents: paidCents - owedCents,
    lastWeek: {
      startIso: start.toISOString(),
      endIso: end.toISOString(),
      leads: reminderDue ? quote.leads : 0,
      owedCents: reminderDue ? stillOwedCents : 0,
    },
    quote,
    settled: stillOwedCents === 0,
    payments: counted.map(toPayment),
    earlierPayments: earlier.map(toPayment),
  };
}
