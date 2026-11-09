import type { AdSpendSummary } from "@/lib/adSpend";

/**
 * The ad spend bar, shared by the advertiser's own dashboard and the admin
 * Client accounts list so both always show the same numbers: spent (Meta spend
 * + service fees) out of what they've paid in (after card processing).
 * Client-safe: only types come from lib/adSpend.
 */
export function adSpendProgress(s: Pick<AdSpendSummary, "availableCents" | "chargedCents" | "balanceCents" | "daysLeft">) {
  const pct = s.availableCents > 0 ? Math.min(100, Math.round((s.chargedCents / s.availableCents) * 100)) : 100;
  const out = s.balanceCents <= 0;
  const low = !out && s.daysLeft !== null && s.daysLeft <= 3;
  return { pct, out, low };
}
