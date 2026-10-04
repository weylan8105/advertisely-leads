// Fresh-lead price floor derived from the Facebook cost-per-lead (CPL).
//
// Owner rule (Ryan, Oct 2026): Advertisely never sells a FRESH lead below 2x the
// ad CPL, with a hard minimum of $55. So the breakpoint is a $27.50 CPL — below
// that, 2x CPL would dip under $55, so the $55 minimum governs; at/above it, the
// 2x-CPL figure governs. CPL is measured on the Enhanced Wealth ad account over
// a trailing 7 days (see lib/metaInsights.ts).

export const CPL_PRICE_MULTIPLIER = 2;
export const HARD_MIN_FRESH_CENTS = 5500; // $55.00

/**
 * The fresh-lead price floor (in cents) for a given ad CPL (in cents).
 * Unknown/zero CPL falls back to the hard $55 minimum.
 */
export function freshFloorCents(cplCents: number | null | undefined): number {
  const twoX = cplCents && cplCents > 0 ? Math.round(cplCents * CPL_PRICE_MULTIPLIER) : 0;
  return Math.max(twoX, HARD_MIN_FRESH_CENTS);
}

/**
 * Apply the floor to a configured base fresh price (cents): never charge below
 * the floor, but keep a higher configured price if one is set.
 */
export function applyFreshFloor(baseCents: number, cplCents: number | null | undefined): number {
  return Math.max(baseCents, freshFloorCents(cplCents));
}
