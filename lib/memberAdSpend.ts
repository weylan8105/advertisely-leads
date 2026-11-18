import { MANUAL_PAYMENT_METHODS, type AdSpendSummary } from "./adSpend";

/**
 * What a team member who runs their own campaign puts into ad spend, for their
 * upline's Team page (/api/team/member-ad-spend). Card amounts are before the
 * 3% fee.
 */

const DAY_MS = 86_400_000;
const TEAM_CHECKOUT_TITLE = /^team campaign funding/i;
// Money recorded by hand ("other" is used for balances moved between accounts, not new money).
const MANUAL = new Set<string>(MANUAL_PAYMENT_METHODS.filter((m) => m !== "other"));

/** Pure: ad-spend money this person put in over the last 7 and 28 days. */
export function weeklyPaidIn(
  s: Pick<AdSpendSummary, "payments" | "otherStripePayments">,
  now = Date.now(),
): { last7Cents: number; avgWeekCents: number } {
  const paid = [
    ...s.payments.filter((p) => p.amountCents > 0 && (p.method === "card" || MANUAL.has(p.method))),
    ...s.otherStripePayments.filter((p) => p.amountCents > 0 && TEAM_CHECKOUT_TITLE.test(p.description ?? "")),
  ];
  const since = (days: number) =>
    paid.filter((p) => now - new Date(p.at).getTime() <= days * DAY_MS).reduce((n, p) => n + p.amountCents, 0);
  return { last7Cents: since(7), avgWeekCents: Math.round(since(28) / 4) };
}
