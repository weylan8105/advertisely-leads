// The advertiser ad-spend ledger: what a client has paid us (Stripe) against
// what their own Meta campaign has spent, so their dashboard can show how much
// budget is left before they need to add more.
//
// How a client's money is used:
//   - 3% of each payment covers card processing (Stripe's fee, passed through at
//     cost); the other 97% is available for ads
//   - every dollar of Meta spend comes out of that
//   - a 20% service fee on the part of a calendar month's spend over $15,000
// A client's campaigns are the "Advertisely Advertiser - <Name>" campaigns in
// our ad accounts (or the ids set on User.adCampaignIds). With budget management
// on (User.adSpendAutoPause), manageAdSpend keeps the campaign's Meta spend cap
// at what they've paid for, paces the daily budget to spend it by their target
// date, and pauses the campaign when it runs out.

import { prisma } from "./prisma";
import { TEAM_AD_SPEND_KIND, teamFunding, teamFundingPayments, type TeamFunding } from "./teamAdSpend";
import { stripe } from "./stripe";
import { setCampaignStatus, setCampaignSpendCap, setDailyBudget } from "./metaAds";

export const PROCESSING_FEE_RATE = 0.03; // of each payment
export const SERVICE_FEE_RATE = 0.2;
export const SERVICE_FEE_THRESHOLD_CENTS = 1_500_000; // $15,000 of spend per calendar month
export const MIN_TOP_UP_CENTS = 10_000; // $100
export const MAX_TOP_UP_CENTS = 5_000_000; // $50,000
export const AD_SPEND_KIND = "ad-spend"; // Stripe metadata.kind on top-ups

export const CLIENT_CAMPAIGN_PREFIX = "Advertisely Advertiser - ";

// Meta's minimum campaign spending limit.
const MIN_SPEND_CAP_CENTS = 10_000;
// Below this much spend left, pause rather than cap.
const PAUSE_BELOW_CENTS = 100;
// Pacing: never set a daily budget under $10, move at most 2x (or down to half)
// in one step so delivery isn't thrown around, and skip changes under 10%.
const MIN_DAILY_BUDGET_CENTS = 1_000;
const MAX_BUDGET_STEP = 2;
const MIN_BUDGET_CHANGE = 0.1;
const TZ = "America/Chicago"; // the ABCA account's reporting timezone

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const READ_TOKEN = process.env.META_ADS_ACCESS_TOKEN || process.env.META_ADS_MANAGE_TOKEN;
const AD_ACCOUNTS = [
  process.env.ABCA_AD_ACCOUNT_ID || "2126340781245705",
  process.env.ENHANCED_WEALTH_AD_ACCOUNT_ID || "2254810101392917",
].map((id) => `act_${id.replace(/^act_/, "").replace(/\D/g, "")}`);

// ─── Pricing ─────────────────────────────────────────────────────────

export interface MonthCharge {
  month: string; // YYYY-MM
  spendCents: number;
  serviceFeeCents: number;
  chargedCents: number;
}

/** The processing fee taken from one payment. */
export const processingFeeCents = (amountCents: number) => Math.round(amountCents * PROCESSING_FEE_RATE);

/** What a calendar month of Meta spend uses of the client's budget. */
export function chargeForMonth(month: string, spendCents: number): MonthCharge {
  const serviceFeeCents = Math.round(Math.max(0, spendCents - SERVICE_FEE_THRESHOLD_CENTS) * SERVICE_FEE_RATE);
  return { month, spendCents, serviceFeeCents, chargedCents: spendCents + serviceFeeCents };
}

/**
 * How much more Meta spend a balance covers this month, given what the month
 * has already spent: $1 per dollar up to $15,000, then $1.20 per dollar.
 */
export function affordableSpendCents(balanceCents: number, monthSpendCents: number): number {
  if (balanceCents <= 0) return 0;
  const belowThreshold = Math.max(0, SERVICE_FEE_THRESHOLD_CENTS - monthSpendCents);
  if (balanceCents <= belowThreshold) return Math.floor(balanceCents);
  return Math.floor(belowThreshold + (balanceCents - belowThreshold) / (1 + SERVICE_FEE_RATE));
}

// ─── Pacing ──────────────────────────────────────────────────────────

/** YYYY-MM-DD in the ad account's timezone. */
export function ymdIn(d: Date, tz = TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The last day of the month `ymd` is in. */
/** Ad spend is paced over a week: each payment over the 7 days after it's made. */
export const PACING_DAYS = 7;

function addDays(ymd: string, days: number): string {
  return new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The date leftover budget should be spent by: theirs if set and still ahead, else a week out. */
export function targetDateFor(target: Date | null, now = new Date()): string {
  const today = ymdIn(now);
  const set = target ? target.toISOString().slice(0, 10) : null;
  return set && set >= today ? set : addDays(today, PACING_DAYS - 1);
}

/** Each ad-spend payment becomes a week to spend it in. */
export function paymentPeriods(payments: ClientPayment[], days = PACING_DAYS): AdSpendPeriod[] {
  return payments
    .filter((p) => p.amountCents > 0)
    .map((p) => ({
      amountCents: p.amountCents,
      netCents: p.amountCents - p.processingFeeCents,
      startsAt: p.at,
      endsAt: new Date(Date.parse(p.at) + days * 86_400_000).toISOString(),
      renews: false,
    }));
}

/** Days from today through `targetYmd`, both included. */
export function daysThrough(targetYmd: string, now = new Date()): number {
  const today = ymdIn(now);
  const ms = Date.parse(`${targetYmd}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

/** One ad-spend payment and the week it's meant to be spent in. */
export interface AdSpendPeriod {
  amountCents: number; // before card processing
  netCents: number; // after card processing
  startsAt: string; // ISO
  endsAt: string; // ISO
  renews: boolean; // reserved: a renewing subscription
}

/** A client's Stripe subscription, as seen by the ad-spend reader (for admins checking it). */
export interface ClientSubscription {
  id: string;
  status: string;
  adSpend: boolean;
  lines: { description: string; amountCents: number; periodEnd: string | null }[];
}

/**
 * The daily spend that uses a client's budget on schedule. Each payment is spent
 * at its own rate (its amount ÷ 7 days) through the week after it was made;
 * anything earlier weeks didn't spend is spread to the target date (a week out).
 */
export function idealDailyCents(allowedCents: number, periods: AdSpendPeriod[], targetYmd: string, now = new Date()): number {
  if (allowedCents <= 0) return 0;
  let rate = 0;
  let reserved = 0; // what the periods still have to spend, at their rates
  for (const p of periods) {
    const start = Date.parse(p.startsAt);
    const end = Date.parse(p.endsAt);
    if (!(end > now.getTime()) || !(end > start)) continue;
    const r = p.netCents / Math.max(1, (end - start) / 86_400_000);
    rate += r;
    reserved += r * ((end - Math.max(start, now.getTime())) / 86_400_000);
  }
  if (rate > 0 && allowedCents <= reserved) return Math.floor((rate * allowedCents) / reserved);
  return Math.floor(rate + (allowedCents - reserved) / daysThrough(targetYmd, now));
}

/** The daily budget that spends `remainingCents` by the target, within the step limits. */
export function pacedDailyBudget(remainingCents: number, days: number, currentCents: number | null): number {
  let want = Math.floor(remainingCents / Math.max(1, days));
  if (currentCents && currentCents > 0) {
    want = Math.min(want, currentCents * MAX_BUDGET_STEP);
    want = Math.max(want, Math.floor(currentCents / MAX_BUDGET_STEP));
  }
  return Math.max(MIN_DAILY_BUDGET_CENTS, Math.round(want / 100) * 100);
}

// ─── Meta spend ──────────────────────────────────────────────────────

export interface ClientCampaign {
  id: string;
  name: string;
  status: string | null; // effective_status
  dailyBudgetCents: number | null; // active ad sets' budgets, or the campaign budget
  campaignBudgetCents: number | null; // set when the budget is on the campaign (CBO)
  adsets: { id: string; status: string | null; dailyBudgetCents: number }[];
  spendCapCents: number | null;
  lifetimeSpendCents: number;
}

const toCents = (v: unknown) => Math.round((parseFloat(String(v ?? "0")) || 0) * 100);

async function graphRows(url: string): Promise<any[]> {
  const rows: any[] = [];
  let next: string | null = url;
  while (next && rows.length < 2000) {
    const res: Response = await fetch(next, { cache: "no-store" });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Graph API ${res.status}`);
    rows.push(...(data.data ?? []));
    next = data.paging?.next ?? null;
  }
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** The client's campaigns: the ids set on their account, else the ones named for them. */
async function findClientCampaigns(name: string | null, ids: string[]): Promise<any[]> {
  const tok = `access_token=${encodeURIComponent(READ_TOKEN!)}`;
  const fields = "id,name,effective_status,daily_budget,spend_cap";
  if (ids.length) {
    return Promise.all(
      ids.map(async (id) => {
        const res = await fetch(`${GRAPH}/${encodeURIComponent(id)}?fields=${fields}&${tok}`, { cache: "no-store" });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Graph API ${res.status}`);
        return data;
      }),
    );
  }
  if (!name?.trim()) return [];
  const want = norm(`${CLIENT_CAMPAIGN_PREFIX}${name}`);
  const filter = encodeURIComponent(JSON.stringify([{ field: "name", operator: "CONTAIN", value: CLIENT_CAMPAIGN_PREFIX.trim() }]));
  const lists = await Promise.all(
    AD_ACCOUNTS.map((acct) => graphRows(`${GRAPH}/${acct}/campaigns?fields=${fields}&filtering=${filter}&limit=200&${tok}`)),
  );
  return lists.flat().filter((c) => norm(String(c.name ?? "")) === want);
}

interface MetaSpend {
  campaigns: ClientCampaign[];
  monthlySpendCents: Record<string, number>;
}

async function metaSpend(name: string | null, ids: string[]): Promise<MetaSpend> {
  const raw = await findClientCampaigns(name, ids);
  const tok = `access_token=${encodeURIComponent(READ_TOKEN!)}`;
  const monthlySpendCents: Record<string, number> = {};
  const campaigns = await Promise.all(
    raw.map(async (c): Promise<ClientCampaign> => {
      const id = String(c.id);
      const [months, adsets] = await Promise.all([
        graphRows(`${GRAPH}/${id}/insights?fields=spend&date_preset=maximum&time_increment=monthly&limit=100&${tok}`),
        graphRows(`${GRAPH}/${id}/adsets?fields=id,daily_budget,effective_status&limit=100&${tok}`),
      ]);
      let lifetimeSpendCents = 0;
      for (const m of months) {
        const cents = toCents(m.spend);
        const month = String(m.date_start ?? "").slice(0, 7);
        monthlySpendCents[month] = (monthlySpendCents[month] ?? 0) + cents;
        lifetimeSpendCents += cents;
      }
      const adsetBudget = adsets
        .filter((a) => a.effective_status === "ACTIVE")
        .reduce((sum, a) => sum + (parseInt(String(a.daily_budget ?? "0"), 10) || 0), 0);
      const campaignBudget = parseInt(String(c.daily_budget ?? "0"), 10) || 0;
      const cap = parseInt(String(c.spend_cap ?? "0"), 10) || 0;
      return {
        id,
        name: String(c.name ?? id),
        status: c.effective_status ? String(c.effective_status) : null,
        dailyBudgetCents: campaignBudget || adsetBudget || null,
        campaignBudgetCents: campaignBudget || null,
        adsets: adsets.map((a) => ({
          id: String(a.id),
          status: a.effective_status ? String(a.effective_status) : null,
          dailyBudgetCents: parseInt(String(a.daily_budget ?? "0"), 10) || 0,
        })),
        // Meta reports "no limit" as a huge number.
        spendCapCents: cap > 0 && cap < 1e13 ? cap : null,
        lifetimeSpendCents,
      };
    }),
  );
  return { campaigns, monthlySpendCents };
}

// ─── Stripe payments ─────────────────────────────────────────────────

export interface ClientPayment {
  id: string;
  at: string;
  amountCents: number; // net of refunds
  description: string | null;
  method: string; // "card" for Stripe; zelle | check | wire | cash | other when recorded by an admin
  processingFeeCents: number; // 3% on card payments, 0 otherwise
}

export const MANUAL_PAYMENT_METHODS = ["zelle", "check", "wire", "bank", "cash", "other"] as const;

/** Payments an admin recorded for money sent outside Stripe. No card fee. */
async function manualPayments(userId: string): Promise<ClientPayment[]> {
  if (!prisma) return [];
  const rows = await prisma.adSpendPayment.findMany({ where: { userId }, orderBy: { receivedAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    at: r.receivedAt.toISOString(),
    amountCents: r.amountCents,
    description: r.note,
    method: r.method,
    processingFeeCents: 0,
  }));
}

// The account's charges from the last year, shared across clients for a minute.
let recentChargesCache: { at: number; charges: Promise<any[]> } | null = null;
function recentCharges(): Promise<any[]> {
  if (recentChargesCache && Date.now() - recentChargesCache.at < 60_000) return recentChargesCache.charges;
  const since = Math.floor(Date.now() / 1000) - 365 * 86_400;
  const charges = (async () => {
    const out: any[] = [];
    for await (const ch of stripe!.charges.list({ created: { gte: since }, limit: 100, expand: ["data.payment_intent"] })) out.push(ch);
    return out;
  })();
  recentChargesCache = { at: Date.now(), charges };
  charges.catch(() => { recentChargesCache = null; });
  return charges;
}

/** A Stripe payment counts toward the ad budget only when it's titled ad spend. */
export const AD_SPEND_TITLE = /\bad[\s-]*spend\b/i;

/**
 * What a charge was for: the app's own top-up tag, the charge / PaymentIntent
 * description, and the product names on its invoice or Checkout session.
 */
async function chargeTitles(c: any): Promise<string[]> {
  const titles: string[] = [];
  if (c.metadata?.kind === AD_SPEND_KIND) titles.push("Advertisely campaign ad spend");
  if (c.description) titles.push(String(c.description));
  const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
  if (!pi || !stripe) return titles;
  if (typeof c.payment_intent === "object" && c.payment_intent?.description) titles.push(String(c.payment_intent.description));
  const [invoicePayments, sessions] = await Promise.all([
    stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 10 }).catch(() => ({ data: [] as any[] })),
    stripe.checkout.sessions.list({ payment_intent: pi, limit: 5, expand: ["data.line_items"] }).catch(() => ({ data: [] as any[] })),
  ]);
  for (const ip of invoicePayments.data as any[]) {
    const id = typeof ip.invoice === "string" ? ip.invoice : ip.invoice?.id;
    if (!id) continue;
    const inv: any = await stripe.invoices.retrieve(id).catch(() => null);
    if (inv?.description) titles.push(String(inv.description));
    for (const line of inv?.lines?.data ?? []) if (line.description) titles.push(String(line.description));
  }
  for (const session of sessions.data as any[]) {
    for (const li of session.line_items?.data ?? []) if (li.description) titles.push(String(li.description));
  }
  return titles;
}

/**
 * The client's successful Stripe charges (net of refunds), split into ad-spend
 * payments, which fund their campaign, and everything else (the monthly
 * service subscription, lead orders), which doesn't.
 */
type StripeAdSpend = { adSpend: ClientPayment[]; other: ClientPayment[]; subscriptions: ClientSubscription[] };

/** The client's Stripe subscriptions and their latest invoice lines (shown to admins). */
async function clientSubscriptions(customerIds: string[]): Promise<ClientSubscription[]> {
  const subscriptions: ClientSubscription[] = [];
  if (!stripe) return subscriptions;
  for (const customer of customerIds) {
    const subs = await stripe.subscriptions.list({ customer, status: "all", limit: 20, expand: ["data.latest_invoice"] });
    for (const sub of subs.data as any[]) {
      const inv = sub.latest_invoice;
      const lines = (inv?.lines?.data ?? []) as any[];
      const record: ClientSubscription = {
        id: sub.id,
        status: sub.status,
        adSpend: false,
        lines: lines.map((l) => ({
          description: String(l.description ?? ""),
          amountCents: l.amount ?? 0,
          periodEnd: l.period?.end ? new Date(l.period.end * 1000).toISOString() : null,
        })),
      };
      record.adSpend = lines.some((l) => AD_SPEND_TITLE.test(String(l.description ?? "")));
      subscriptions.push(record);
    }
  }
  return subscriptions;
}

async function stripePayments(paymentEmails: string[]): Promise<StripeAdSpend> {
  if (!stripe) return { adSpend: [], other: [], subscriptions: [] };
  const emails = [...new Set(paymentEmails.flatMap((e) => [e.trim(), e.trim().toLowerCase()]).filter(Boolean))];
  const customers = (await Promise.all(emails.map((e) => stripe!.customers.list({ email: e, limit: 100 })))).flatMap((r) => r.data);
  const customerIds = [...new Set(customers.map((c) => c.id))];

  const byId = new Map<string, any>();
  for (const customer of customerIds) {
    for await (const ch of stripe.charges.list({ customer, limit: 100, expand: ["data.payment_intent"] })) byId.set(ch.id, ch);
  }
  // Guest payments (payment links, invoices paid without a saved customer)
  // carry the email only on the charge's billing details or receipt.
  const wanted = new Set(emails.map((e) => e.toLowerCase()));
  for (const ch of await recentCharges()) {
    const e = String(ch.billing_details?.email ?? ch.receipt_email ?? "").toLowerCase();
    if (e && wanted.has(e) && !byId.has(ch.id)) byId.set(ch.id, ch);
  }
  const charges = [...byId.values()];
  if (!charges.length) return { adSpend: [], other: [], subscriptions: [] };

  const adSpend: ClientPayment[] = [];
  const other: ClientPayment[] = [];
  await Promise.all(
    charges
      .filter((c) => c.status === "succeeded" && c.paid && (c.amount ?? 0) - (c.amount_refunded ?? 0) > 0)
      .map(async (c) => {
        const titles = await chargeTitles(c);
        const amountCents = (c.amount ?? 0) - (c.amount_refunded ?? 0);
        // A downline funding someone else's campaign: counted there (lib/teamAdSpend.ts), never here.
        const piKind = typeof c.payment_intent === "object" ? c.payment_intent?.metadata?.kind : undefined;
        const isTeamFunding = c.metadata?.kind === TEAM_AD_SPEND_KIND || piKind === TEAM_AD_SPEND_KIND;
        const isAdSpend = !isTeamFunding && (c.metadata?.kind === AD_SPEND_KIND || titles.some((t) => AD_SPEND_TITLE.test(t)));
        const payment: ClientPayment = {
          id: String(c.id),
          at: new Date(c.created * 1000).toISOString(),
          amountCents,
          description: titles.find((t) => AD_SPEND_TITLE.test(t)) ?? titles[titles.length - 1] ?? null,
          method: "card",
          processingFeeCents: isAdSpend ? processingFeeCents(amountCents) : 0,
        };
        (isAdSpend ? adSpend : other).push(payment);
      }),
  );
  const byDate = (a: ClientPayment, b: ClientPayment) => b.at.localeCompare(a.at);
  // Subscriptions live on a customer even when the charge was matched by billing email.
  const allCustomers = [...new Set([...customerIds, ...charges.map((c) => (typeof c.customer === "string" ? c.customer : c.customer?.id)).filter(Boolean)])];
  const subscriptions = await clientSubscriptions(allCustomers).catch((e) => {
    console.error("[adSpend] subscription lookup failed", (e as Error).message);
    return [] as ClientSubscription[];
  });
  return { adSpend: adSpend.sort(byDate), other: other.sort(byDate), subscriptions };
}

// ─── Summary ─────────────────────────────────────────────────────────

export interface AdSpendSummary {
  userId: string;
  name: string | null;
  email: string;
  paidCents: number;
  processingFeeCents: number; // 3% of card payments, passed through to Stripe
  availableCents: number; // paid − processing
  payments: ClientPayment[]; // what funds the campaign: ad-spend card payments + Zelle etc.
  otherStripePayments: ClientPayment[]; // service subscription, lead orders: not ad budget
  months: MonthCharge[]; // newest first
  spendCents: number; // Meta spend
  serviceFeeCents: number;
  chargedCents: number; // spend + service fees
  balanceCents: number; // available − charged
  thisMonth: MonthCharge;
  leads: number;
  leadsThisMonth: number;
  costPerLeadCents: number | null;
  dailyBudgetCents: number | null;
  daysLeft: number | null;
  // Pacing: spend what's left by targetDate at about pacedDailyCents a day.
  targetDate: string; // YYYY-MM-DD
  targetDateSet: boolean; // false = defaulting to month end
  pacedDailyCents: number | null;
  periods: AdSpendPeriod[]; // each ad-spend payment and the week it's spent in
  teamFunding: TeamFunding[]; // downlines who added spend (lib/teamAdSpend.ts)
  teamCreditCents: number; // their unspent credit, part of balanceCents
  subscriptions: ClientSubscription[];
  campaigns: ClientCampaign[];
  autoPause: boolean;
  pausedForBudget: boolean;
  errors: string[];
}

const summaryCache = new Map<string, { at: number; summary: AdSpendSummary }>();
const SUMMARY_TTL_MS = 60 * 1000;

function monthKey(d: Date): string {
  // Client campaigns run in the ABCA account, which reports in Central time.
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${parts.find((p) => p.type === "year")?.value}-${parts.find((p) => p.type === "month")?.value}`;
}

async function leadCounts(label: string): Promise<{ total: number; thisMonth: number }> {
  if (!prisma) return { total: 0, thisMonth: 0 };
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(6, 0, 0, 0); // midnight Central, near enough for a count
  const rows = await prisma.$queryRaw<{ total: bigint; this_month: bigint }[]>`
    SELECT count(*) AS total, count(*) FILTER (WHERE "receivedAt" >= ${monthStart}) AS this_month
    FROM "Lead"
    WHERE "rawFormData"->>'advertiser_name' = ${label} AND "trashedAt" IS NULL`;
  return { total: Number(rows[0]?.total ?? 0), thisMonth: Number(rows[0]?.this_month ?? 0) };
}

export async function getAdSpendSummary(userId: string, opts: { fresh?: boolean } = {}): Promise<AdSpendSummary | null> {
  if (!prisma) return null;
  const cached = summaryCache.get(userId);
  if (!opts.fresh && cached && Date.now() - cached.at < SUMMARY_TTL_MS) return cached.summary;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, name: true, email: true, adCampaignIds: true, adSpendAutoPause: true,
      adSpendPausedCampaignIds: true, adSpendTargetDate: true, adSpendEmails: true,
    },
  });
  if (!user) return null;

  const errors: string[] = [];
  const [meta, cardPayments, otherPayments, leads, teamPayments, team] = await Promise.all([
    READ_TOKEN
      ? metaSpend(user.name, user.adCampaignIds).catch((e) => {
          errors.push(`Meta: ${(e as Error).message}`);
          return { campaigns: [], monthlySpendCents: {} } as MetaSpend;
        })
      : (errors.push("Meta isn't connected."), { campaigns: [], monthlySpendCents: {} } as MetaSpend),
    stripePayments([user.email, ...user.adSpendEmails]).catch((e) => {
      errors.push(`Stripe: ${(e as Error).message}`);
      return { adSpend: [] as ClientPayment[], other: [] as ClientPayment[], subscriptions: [] } as StripeAdSpend;
    }),
    manualPayments(user.id),
    // deliverLeadToOwner stamps this label on every lead from the client's campaign.
    leadCounts(user.name?.trim() || user.email),
    // Downlines' top-ups fund this campaign too.
    teamFundingPayments(user.id).catch((e) => {
      errors.push(`Team spend: ${(e as Error).message}`);
      return [] as ClientPayment[];
    }),
    teamFunding(user.id).catch(() => [] as TeamFunding[]),
  ]);
  if (!stripe) errors.push("Stripe isn't connected.");
  // A failed read must never look like a $0 balance (and pause a campaign).
  if (READ_TOKEN && !meta.campaigns.length && !errors.length) errors.push("No campaign found for this client.");

  const thisMonthKey = monthKey(new Date());
  const months = Object.entries(meta.monthlySpendCents)
    .map(([m, cents]) => chargeForMonth(m, cents))
    .sort((a, b) => b.month.localeCompare(a.month));
  const thisMonth = months.find((m) => m.month === thisMonthKey) ?? chargeForMonth(thisMonthKey, 0);
  const sum = (k: keyof Omit<MonthCharge, "month">) => months.reduce((s, m) => s + m[k], 0);
  const payments = [...cardPayments.adSpend, ...otherPayments, ...teamPayments].sort((a, b) => b.at.localeCompare(a.at));
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const processing = payments.reduce((s, p) => s + p.processingFeeCents, 0);
  const chargedCents = sum("chargedCents");
  const balanceCents = paidCents - processing - chargedCents;
  const activeBudget = meta.campaigns
    .filter((c) => c.status === "ACTIVE" || user.adSpendPausedCampaignIds.includes(c.id))
    .reduce((s, c) => s + (c.dailyBudgetCents ?? 0), 0);
  const targetDate = targetDateFor(user.adSpendTargetDate);
  const periods = paymentPeriods(payments);
  const remaining = affordableSpendCents(balanceCents, thisMonth.spendCents);

  const summary: AdSpendSummary = {
    userId: user.id,
    name: user.name,
    email: user.email,
    paidCents,
    processingFeeCents: processing,
    availableCents: paidCents - processing,
    payments,
    otherStripePayments: cardPayments.other,
    months,
    spendCents: sum("spendCents"),
    serviceFeeCents: sum("serviceFeeCents"),
    chargedCents,
    balanceCents,
    thisMonth,
    leads: leads.total,
    leadsThisMonth: leads.thisMonth,
    costPerLeadCents: leads.total > 0 ? Math.round(sum("spendCents") / leads.total) : null,
    dailyBudgetCents: activeBudget || null,
    daysLeft: activeBudget > 0 ? Math.max(0, Math.floor(balanceCents / activeBudget)) : null,
    targetDate,
    targetDateSet: !!user.adSpendTargetDate && targetDate === user.adSpendTargetDate.toISOString().slice(0, 10),
    pacedDailyCents: remaining > 0 ? Math.max(MIN_DAILY_BUDGET_CENTS, idealDailyCents(remaining, periods, targetDate)) : null,
    periods,
    teamFunding: team,
    teamCreditCents: team.reduce((t, f) => t + Math.max(0, f.creditCents), 0),
    subscriptions: cardPayments.subscriptions,
    campaigns: meta.campaigns,
    autoPause: user.adSpendAutoPause,
    pausedForBudget: user.adSpendPausedCampaignIds.length > 0,
    errors,
  };
  summaryCache.set(userId, { at: Date.now(), summary });
  return summary;
}

/**
 * The campaign's cost per lead for charging a downline's credit, or null when
 * it can't be trusted right now (Meta unreadable, no campaign, no leads yet).
 */
export async function campaignCplCents(userId: string): Promise<number | null> {
  const s = await getAdSpendSummary(userId).catch(() => null);
  if (!s || !s.costPerLeadCents || s.costPerLeadCents <= 0) return null;
  if (s.errors.some((e) => e.startsWith("Meta") || e.startsWith("No campaign"))) return null;
  return s.costPerLeadCents;
}

/** Drop a cached summary (a payment just landed). */
export function forgetAdSpendSummary(userId: string) {
  summaryCache.delete(userId);
}

// ─── Budget management ───────────────────────────────────────────────

export interface EnforceResult {
  userId: string;
  action: "skipped" | "capped" | "paused" | "none";
  detail: string;
}

/**
 * Set the daily budget(s) of a live campaign to `dailyCents` in total: on the
 * campaign for CBO, else split across its active ad sets in proportion to what
 * they have now. Returns how many budgets changed.
 */
async function paceCampaign(c: ClientCampaign, dailyCents: number): Promise<number> {
  const differs = (now: number, want: number) => !now || Math.abs(want - now) / now >= MIN_BUDGET_CHANGE;
  if (c.campaignBudgetCents) {
    if (!differs(c.campaignBudgetCents, dailyCents)) return 0;
    await setDailyBudget(c.id, dailyCents);
    return 1;
  }
  const active = c.adsets.filter((a) => a.status === "ACTIVE");
  const total = active.reduce((s, a) => s + a.dailyBudgetCents, 0);
  if (!active.length || !differs(total, dailyCents)) return 0;
  let changed = 0;
  for (const a of active) {
    const share = total > 0 ? a.dailyBudgetCents / total : 1 / active.length;
    const want = Math.max(MIN_DAILY_BUDGET_CENTS / active.length, Math.round((dailyCents * share) / 100) * 100);
    await setDailyBudget(a.id, Math.max(100, want));
    changed++;
  }
  return changed;
}

/**
 * Keep a client's campaigns inside what they've paid for and on pace: a Meta
 * spend cap at the spend their balance covers (Meta stops delivery there on its
 * own), a daily budget that spends it by their target date, a pause once it's
 * used up, and a resume of what we paused once they add more. Only for clients
 * with management on, and never on a summary with read errors.
 */
export async function enforceAdSpend(userId: string): Promise<EnforceResult> {
  if (!prisma) return { userId, action: "skipped", detail: "no database" };
  const s = await getAdSpendSummary(userId, { fresh: true });
  if (!s) return { userId, action: "skipped", detail: "no user" };
  if (!s.autoPause) return { userId, action: "skipped", detail: "budget management is off" };
  if (s.errors.length) return { userId, action: "skipped", detail: s.errors.join("; ") };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { adSpendPausedCampaignIds: true } });
  const pausedByUs = new Set(user?.adSpendPausedCampaignIds ?? []);
  const live = s.campaigns.filter((c) => c.status === "ACTIVE" || pausedByUs.has(c.id));
  // Paused ones are capped too, so turning one back on by hand stays inside the budget.
  const cappable = s.campaigns.filter((c) => c.status !== "ARCHIVED" && c.status !== "DELETED");
  const allowedCents = affordableSpendCents(s.balanceCents, s.thisMonth.spendCents);

  if (allowedCents < PAUSE_BELOW_CENTS) {
    const toPause = live.filter((c) => c.status === "ACTIVE");
    for (const c of toPause) await setCampaignStatus(c.id, "PAUSED");
    await prisma.user.update({
      where: { id: userId },
      data: { adSpendPausedCampaignIds: [...new Set([...pausedByUs, ...toPause.map((c) => c.id)])] },
    });
    summaryCache.delete(userId);
    return { userId, action: "paused", detail: `${toPause.length} campaign(s) paused; balance ${s.balanceCents}¢` };
  }

  // Split what's left across the campaigns; Meta enforces each cap.
  const share = Math.floor(allowedCents / Math.max(1, cappable.length));
  let changed = 0;
  for (const c of cappable) {
    const cap = Math.max(MIN_SPEND_CAP_CENTS, c.lifetimeSpendCents + share);
    if (c.spendCapCents === null || Math.abs(c.spendCapCents - cap) >= 100) {
      await setCampaignSpendCap(c.id, cap);
      changed++;
    }
    if (pausedByUs.has(c.id)) await setCampaignStatus(c.id, "ACTIVE");
  }
  // Pace: each payment over the week after it, leftovers by the target date (a week out).
  const liveNow = s.campaigns.filter((c) => c.status === "ACTIVE" || pausedByUs.has(c.id));
  const ideal = idealDailyCents(allowedCents, s.periods, s.targetDate);
  let paced = 0;
  let dailyTotal = 0;
  for (const c of liveNow) {
    const daily = pacedDailyBudget(Math.floor(ideal / liveNow.length), 1, c.dailyBudgetCents);
    dailyTotal += daily;
    paced += await paceCampaign(c, daily);
  }
  await prisma.user.update({
    where: { id: userId },
    data: { adSpendPacedAt: new Date(), ...(pausedByUs.size ? { adSpendPausedCampaignIds: [] } : {}) },
  });
  summaryCache.delete(userId);
  const parts = [
    `${changed} cap(s) set to cover ${allowedCents}¢ more spend`,
    liveNow.length ? `daily budget ${dailyTotal}¢ (ideal ${ideal}¢${s.periods.some((p) => Date.parse(p.endsAt) > Date.now()) ? `; weeks to ${s.periods.filter((p) => Date.parse(p.endsAt) > Date.now()).map((p) => p.endsAt.slice(0, 10)).join(", ")}` : ""}; target ${s.targetDate})${paced ? "" : " (unchanged)"}` : "",
    pausedByUs.size ? `resumed ${pausedByUs.size}` : "",
  ].filter(Boolean);
  if (!changed && !paced && !pausedByUs.size) return { userId, action: "none", detail: parts.join("; ") };
  return { userId, action: "capped", detail: parts.join("; ") };
}

/** Re-run management for a client if it hasn't run in the last 20 hours. */
export async function manageIfStale(userId: string): Promise<void> {
  if (!prisma) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { adSpendAutoPause: true, adSpendPacedAt: true } });
  if (!u?.adSpendAutoPause) return;
  if (u.adSpendPacedAt && Date.now() - u.adSpendPacedAt.getTime() < 20 * 3_600_000) return;
  await enforceAdSpend(userId);
}

/** Enforce for every advertiser with auto-pause on (daily cron + after top-ups). */
export async function enforceAllAdSpend(): Promise<EnforceResult[]> {
  if (!prisma) return [];
  const users = await prisma.user.findMany({ where: { isAdvertiser: true, adSpendAutoPause: true }, select: { id: true } });
  const out: EnforceResult[] = [];
  for (const u of users) {
    out.push(await enforceAdSpend(u.id).catch((e) => ({ userId: u.id, action: "skipped" as const, detail: (e as Error).message })));
  }
  return out;
}
