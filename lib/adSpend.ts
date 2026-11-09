// The advertiser ad-spend ledger: what a client has paid us (Stripe) against
// what their own Meta campaign has spent, so their dashboard can show how much
// budget is left before they need to add more.
//
// What we charge for spend:
//   - every dollar of Meta spend, plus 3% to cover Stripe's card fee
//   - a 20% service fee on the part of a calendar month's spend over $15,000
// A client's campaigns are the "Advertisely Advertiser - <Name>" campaigns in
// our ad accounts (or the ids set on User.adCampaignIds). When auto-pause is on
// for the client, the campaign's Meta spend cap is kept at what they've paid
// for, and it's paused when that runs out (enforceAdSpend).

import { prisma } from "./prisma";
import { stripe } from "./stripe";
import { setCampaignStatus, setCampaignSpendCap } from "./metaAds";

export const CARD_FEE_RATE = 0.03;
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
  cardFeeCents: number;
  serviceFeeCents: number;
  chargedCents: number;
}

/** What a calendar month of Meta spend costs the client. */
export function chargeForMonth(month: string, spendCents: number): MonthCharge {
  const cardFeeCents = Math.round(spendCents * CARD_FEE_RATE);
  const serviceFeeCents = Math.round(Math.max(0, spendCents - SERVICE_FEE_THRESHOLD_CENTS) * SERVICE_FEE_RATE);
  return { month, spendCents, cardFeeCents, serviceFeeCents, chargedCents: spendCents + cardFeeCents + serviceFeeCents };
}

/**
 * How much more Meta spend a balance pays for this month, given what the month
 * has already spent: 1.03 per dollar up to $15,000, then 1.23 per dollar.
 */
export function affordableSpendCents(balanceCents: number, monthSpendCents: number): number {
  if (balanceCents <= 0) return 0;
  const belowThreshold = Math.max(0, SERVICE_FEE_THRESHOLD_CENTS - monthSpendCents);
  const lowRate = 1 + CARD_FEE_RATE;
  const highRate = 1 + CARD_FEE_RATE + SERVICE_FEE_RATE;
  if (balanceCents <= belowThreshold * lowRate) return Math.floor(balanceCents / lowRate);
  return Math.floor(belowThreshold + (balanceCents - belowThreshold * lowRate) / highRate);
}

// ─── Meta spend ──────────────────────────────────────────────────────

export interface ClientCampaign {
  id: string;
  name: string;
  status: string | null; // effective_status
  dailyBudgetCents: number | null; // active ad sets' budgets, or the campaign budget
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
        graphRows(`${GRAPH}/${id}/adsets?fields=daily_budget,effective_status&limit=100&${tok}`),
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
}

/**
 * Every successful Stripe charge on the client's Stripe customer(s), net of
 * refunds, except ones the app already records as lead orders or lead
 * subscriptions.
 */
async function stripePayments(email: string): Promise<ClientPayment[]> {
  if (!stripe || !prisma) return [];
  const emails = [...new Set([email, email.toLowerCase()])];
  const customers = (await Promise.all(emails.map((e) => stripe!.customers.list({ email: e, limit: 100 })))).flatMap((r) => r.data);
  const customerIds = [...new Set(customers.map((c) => c.id))];
  if (!customerIds.length) return [];

  const charges: any[] = [];
  for (const customer of customerIds) {
    for await (const ch of stripe.charges.list({ customer, limit: 100 })) charges.push(ch);
  }

  // Lead orders are recorded by PaymentIntent; lead subscriptions by invoice.
  const intentIds = charges.map((c) => (typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id)).filter(Boolean);
  const orderIntents = new Set(
    (await prisma.order.findMany({ where: { stripePaymentIntentId: { in: intentIds } }, select: { stripePaymentIntentId: true } }))
      .map((o) => o.stripePaymentIntentId),
  );
  const subscriptionIntents = new Set<string>();
  const subs = await prisma.leadSubscription.findMany({
    where: { stripeCustomerId: { in: customerIds } },
    select: { stripeSubscriptionId: true },
  });
  for (const { stripeSubscriptionId } of subs) {
    for await (const inv of stripe.invoices.list({ subscription: stripeSubscriptionId, limit: 100, expand: ["data.payments"] }) as any) {
      for (const p of inv.payments?.data ?? []) {
        const pi = p.payment?.payment_intent;
        if (pi) subscriptionIntents.add(typeof pi === "string" ? pi : pi.id);
      }
    }
  }

  return charges
    .filter((c) => c.status === "succeeded" && c.paid)
    .filter((c) => {
      const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
      if (c.metadata?.kind === AD_SPEND_KIND) return true;
      return !(pi && (orderIntents.has(pi) || subscriptionIntents.has(pi)));
    })
    .map((c) => ({
      id: String(c.id),
      at: new Date(c.created * 1000).toISOString(),
      amountCents: (c.amount ?? 0) - (c.amount_refunded ?? 0),
      description: c.description ?? null,
    }))
    .filter((p) => p.amountCents > 0)
    .sort((a, b) => b.at.localeCompare(a.at));
}

// ─── Summary ─────────────────────────────────────────────────────────

export interface AdSpendSummary {
  userId: string;
  name: string | null;
  email: string;
  paidCents: number;
  payments: ClientPayment[];
  months: MonthCharge[]; // newest first
  spendCents: number; // raw Meta spend
  cardFeeCents: number;
  serviceFeeCents: number;
  chargedCents: number; // what the spend costs the client
  balanceCents: number; // paid − charged
  thisMonth: MonthCharge;
  leads: number;
  leadsThisMonth: number;
  costPerLeadCents: number | null;
  dailyBudgetCents: number | null;
  daysLeft: number | null;
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
    select: { id: true, name: true, email: true, adCampaignIds: true, adSpendAutoPause: true, adSpendPausedCampaignIds: true },
  });
  if (!user) return null;

  const errors: string[] = [];
  const [meta, payments, leads] = await Promise.all([
    READ_TOKEN
      ? metaSpend(user.name, user.adCampaignIds).catch((e) => {
          errors.push(`Meta: ${(e as Error).message}`);
          return { campaigns: [], monthlySpendCents: {} } as MetaSpend;
        })
      : (errors.push("Meta isn't connected."), { campaigns: [], monthlySpendCents: {} } as MetaSpend),
    stripePayments(user.email).catch((e) => {
      errors.push(`Stripe: ${(e as Error).message}`);
      return [] as ClientPayment[];
    }),
    // deliverLeadToOwner stamps this label on every lead from the client's campaign.
    leadCounts(user.name?.trim() || user.email),
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
  const paidCents = payments.reduce((s, p) => s + p.amountCents, 0);
  const chargedCents = sum("chargedCents");
  const balanceCents = paidCents - chargedCents;
  const activeBudget = meta.campaigns
    .filter((c) => c.status === "ACTIVE" || user.adSpendPausedCampaignIds.includes(c.id))
    .reduce((s, c) => s + (c.dailyBudgetCents ?? 0), 0);
  const dailyCharge = activeBudget * (1 + CARD_FEE_RATE);

  const summary: AdSpendSummary = {
    userId: user.id,
    name: user.name,
    email: user.email,
    paidCents,
    payments,
    months,
    spendCents: sum("spendCents"),
    cardFeeCents: sum("cardFeeCents"),
    serviceFeeCents: sum("serviceFeeCents"),
    chargedCents,
    balanceCents,
    thisMonth,
    leads: leads.total,
    leadsThisMonth: leads.thisMonth,
    // What each lead has cost the client, card fee included.
    costPerLeadCents: leads.total > 0 ? Math.round((sum("spendCents") + sum("cardFeeCents")) / leads.total) : null,
    dailyBudgetCents: activeBudget || null,
    daysLeft: dailyCharge > 0 ? Math.max(0, Math.floor(balanceCents / dailyCharge)) : null,
    campaigns: meta.campaigns,
    autoPause: user.adSpendAutoPause,
    pausedForBudget: user.adSpendPausedCampaignIds.length > 0,
    errors,
  };
  summaryCache.set(userId, { at: Date.now(), summary });
  return summary;
}

// ─── Auto-pause ──────────────────────────────────────────────────────

export interface EnforceResult {
  userId: string;
  action: "skipped" | "capped" | "paused" | "none";
  detail: string;
}

/**
 * Keep a client's campaigns inside what they've paid for: a Meta spend cap at
 * the spend their balance covers (Meta stops delivery there on its own), a pause
 * once it's used up, and a resume of what we paused once they add more. Only
 * for clients with auto-pause on, and never on a summary with read errors.
 */
export async function enforceAdSpend(userId: string): Promise<EnforceResult> {
  if (!prisma) return { userId, action: "skipped", detail: "no database" };
  const s = await getAdSpendSummary(userId, { fresh: true });
  if (!s) return { userId, action: "skipped", detail: "no user" };
  if (!s.autoPause) return { userId, action: "skipped", detail: "auto-pause is off" };
  if (s.errors.length) return { userId, action: "skipped", detail: s.errors.join("; ") };

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { adSpendPausedCampaignIds: true } });
  const pausedByUs = new Set(user?.adSpendPausedCampaignIds ?? []);
  const live = s.campaigns.filter((c) => c.status === "ACTIVE" || pausedByUs.has(c.id));
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

  // Split what's left across the live campaigns; Meta enforces each cap.
  const share = Math.floor(allowedCents / Math.max(1, live.length));
  let changed = 0;
  for (const c of live) {
    const cap = Math.max(MIN_SPEND_CAP_CENTS, c.lifetimeSpendCents + share);
    if (c.spendCapCents === null || Math.abs(c.spendCapCents - cap) >= 100) {
      await setCampaignSpendCap(c.id, cap);
      changed++;
    }
    if (pausedByUs.has(c.id)) await setCampaignStatus(c.id, "ACTIVE");
  }
  if (pausedByUs.size) {
    await prisma.user.update({ where: { id: userId }, data: { adSpendPausedCampaignIds: [] } });
  }
  summaryCache.delete(userId);
  if (!changed && !pausedByUs.size) return { userId, action: "none", detail: "caps already current" };
  return {
    userId,
    action: "capped",
    detail: `${changed} cap(s) set to cover ${allowedCents}¢ more spend${pausedByUs.size ? `; resumed ${pausedByUs.size}` : ""}`,
  };
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
