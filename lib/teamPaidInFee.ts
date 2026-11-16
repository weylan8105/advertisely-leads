import { prisma } from "./prisma";
import {
  getAdSpendSummary,
  forgetAdSpendSummary,
  ymdIn,
  MANUAL_PAYMENT_METHODS,
  SERVICE_FEE_RATE,
  SERVICE_FEE_THRESHOLD_CENTS,
  type AdSpendSummary,
} from "./adSpend";
import { PAID_IN_FEE_TEAMS, type PaidInFeeTeam } from "./paidInFeeTeams";

/**
 * The 20% management fee on a team's ad spend PAID IN past $15,000 a month
 * (lib/paidInFeeTeams.ts). Each payment that carries the team past the line,
 * and each one after it, gets one fee row on the payer's own balance:
 * AdSpendPayment id `teamfee_<payment id>`, so it's charged once however often
 * this runs.
 */

export const TEAM_FEE_METHOD = "team-fee";
const TEAM_CHECKOUT_TITLE = /^team campaign funding/i;
const MANUAL = new Set<string>(MANUAL_PAYMENT_METHODS.filter((m) => m !== "other"));

export interface TeamPayment {
  id: string;
  userId: string;
  at: string; // ISO
  grossCents: number; // what they paid, before the card fee
}

export interface TeamFee {
  payment: TeamPayment;
  month: string; // YYYY-MM, Central
  feeCents: number;
}

const monthOf = (iso: string) => ymdIn(new Date(iso)).slice(0, 7);

/** The fee each payment owes. Pure: payments at or before `settledThrough` count toward the line but are never charged. */
export function paidInFees(payments: TeamPayment[], settledThrough: string): TeamFee[] {
  const running = new Map<string, number>();
  const out: TeamFee[] = [];
  for (const p of [...payments].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    if (p.grossCents <= 0) continue;
    const month = monthOf(p.at);
    const before = running.get(month) ?? 0;
    const after = before + p.grossCents;
    running.set(month, after);
    const overCents = Math.max(0, after - Math.max(before, SERVICE_FEE_THRESHOLD_CENTS));
    const feeCents = Math.round(overCents * SERVICE_FEE_RATE);
    if (feeCents > 0 && p.at > settledThrough) out.push({ payment: p, month, feeCents });
  }
  return out;
}

/** The money one account paid in: own card top-ups, team checkout charges, and money sent outside Stripe. */
export function paymentsPaidIn(s: Pick<AdSpendSummary, "userId" | "payments" | "otherStripePayments">): TeamPayment[] {
  const out: TeamPayment[] = [];
  for (const p of s.payments) {
    // Card top-ups. A Program member's top-up has no card fee (theirs is per lead) and is already marked up 20% per lead.
    const card = p.method === "card" && p.processingFeeCents > 0;
    if ((card || MANUAL.has(p.method)) && p.amountCents > 0) out.push({ id: p.id, userId: s.userId, at: p.at, grossCents: p.amountCents });
  }
  for (const p of s.otherStripePayments) {
    if (TEAM_CHECKOUT_TITLE.test(p.description ?? "") && p.amountCents > 0) out.push({ id: p.id, userId: s.userId, at: p.at, grossCents: p.amountCents });
  }
  return out;
}

/** The advertiser plus everyone on their team or funding their campaign. */
async function teamUserIds(advertiserId: string): Promise<string[]> {
  if (!prisma) return [advertiserId];
  const [ledger, members] = await Promise.all([
    prisma.teamAdSpend.findMany({ where: { advertiserId }, select: { userId: true }, distinct: ["userId"] }),
    prisma.membership.findMany({ where: { organization: { ownerId: advertiserId } }, select: { userId: true } }),
  ]);
  return [...new Set([advertiserId, ...ledger.map((r) => r.userId), ...members.map((m) => m.userId)])];
}

const usd = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

const lastRun = new Map<string, number>();
const THROTTLE_MS = 20_000;

/** Charge any fee a team owes and hasn't been charged. Returns the rows added. */
export async function reconcileTeamFee(team: PaidInFeeTeam, opts: { force?: boolean } = {}): Promise<number> {
  if (!prisma) return 0;
  if (!opts.force && Date.now() - (lastRun.get(team.advertiserId) ?? 0) < THROTTLE_MS) return 0;
  lastRun.set(team.advertiserId, Date.now());

  const ids = await teamUserIds(team.advertiserId);
  const summaries: AdSpendSummary[] = [];
  for (const id of ids) {
    const s = await getAdSpendSummary(id, { fresh: true }).catch(() => null);
    // A failed Stripe read could hide a payment and shift who crossed the line: try again later.
    if (s?.errors.some((e) => e.startsWith("Stripe"))) return 0;
    if (s) summaries.push(s);
  }
  const byId = new Map(summaries.flatMap(paymentsPaidIn).map((p) => [p.id, p]));
  const fees = paidInFees([...byId.values()], team.settledThrough);
  if (!fees.length) return 0;

  const res = await prisma.adSpendPayment.createMany({
    data: fees.map((f) => ({
      id: `teamfee_${f.payment.id}`,
      userId: f.payment.userId,
      amountCents: -f.feeCents,
      method: TEAM_FEE_METHOD,
      receivedAt: new Date(f.payment.at),
      note: `20% management fee: your team passed $15,000 of ad spend in ${monthName(f.month)} (on your ${usd(f.payment.grossCents)} payment)`,
    })),
    skipDuplicates: true,
  });
  if (res.count) for (const f of fees) forgetAdSpendSummary(f.payment.userId);
  return res.count;
}

/** The fee team this account belongs to, if any. */
export async function paidInFeeTeamFor(userId: string): Promise<PaidInFeeTeam | null> {
  for (const t of PAID_IN_FEE_TEAMS) {
    if (t.advertiserId === userId) return t;
    if ((await teamUserIds(t.advertiserId)).includes(userId)) return t;
  }
  return null;
}

/** Best effort: charge what this account's team owes. Never throws. */
export async function reconcileTeamFeeFor(userId: string, opts: { force?: boolean } = {}): Promise<number> {
  try {
    const team = await paidInFeeTeamFor(userId);
    return team ? await reconcileTeamFee(team, opts) : 0;
  } catch (e) {
    console.warn("[teamFee] reconcile failed", (e as Error).message);
    return 0;
  }
}

/** reconcileTeamFeeFor, but gives up waiting after `ms` (it keeps running) so a page or webhook isn't held up. */
export function reconcileTeamFeeWithin(userId: string, ms: number, opts: { force?: boolean } = {}): Promise<number> {
  return Promise.race([reconcileTeamFeeFor(userId, opts), new Promise<number>((r) => setTimeout(() => r(0), ms))]);
}

/** Every fee team, e.g. from the admin page. */
export async function reconcileAllTeamFees(): Promise<number> {
  let n = 0;
  for (const t of PAID_IN_FEE_TEAMS) n += await reconcileTeamFee(t).catch(() => 0);
  return n;
}
