import { findPackage } from "@/data/packages";

/**
 * Advertisely Bucks Marketing Campaign — pricing (DRAFT — gated by REFERRAL_PROGRAM_ENABLED).
 * Pure + client-safe so the checkout summary and the server price a cart
 * identically. All money is integer cents.
 */

/** Tiers a referral code discounts (and earns Bucks on). Fresh only. */
export const REFERRAL_PACKAGE_IDS = new Set(["iul-fresh"]);
/** 10% off fresh leads with a code. */
export const REFERRAL_DISCOUNT_RATE = 0.1;
/** The code's owner earns $12 in Bucks per discounted lead. */
export const BUCKS_PER_REFERRED_LEAD_CENTS = 1200;
/** Stripe can't charge less than $0.50 — a remainder below this is folded into Bucks. */
export const STRIPE_MIN_CHARGE_CENTS = 50;

export interface PricedLine {
  packageId: string;
  quantity: number;
  listCentsPerLead: number;
  /** What the buyer actually pays per lead (after the code discount). */
  centsPerLead: number;
  discounted: boolean;
}

export interface PricedCart {
  lines: PricedLine[];
  listCents: number;
  discountCents: number;
  /** After the code discount, before Bucks. */
  subtotalCents: number;
  bucksAppliedCents: number;
  /** What's left to charge on a card. 0 = the order is fully covered by Bucks. */
  chargeCents: number;
  /** Bucks the code's owner earns from this checkout. */
  referrerEarnsCents: number;
}

export function priceCart(
  items: { packageId: string; quantity: number }[],
  opts: { codeApplied: boolean; bucksAvailableCents?: number; useBucks?: boolean },
): PricedCart {
  const lines: PricedLine[] = [];
  let listCents = 0;
  let subtotalCents = 0;
  let referredLeads = 0;
  for (const it of items) {
    const pkg = findPackage(it.packageId);
    if (!pkg) continue;
    const list = Math.round(pkg.pricePerLead * 100);
    const discounted = opts.codeApplied && REFERRAL_PACKAGE_IDS.has(pkg.id);
    const per = discounted ? Math.round(list * (1 - REFERRAL_DISCOUNT_RATE)) : list;
    lines.push({ packageId: pkg.id, quantity: it.quantity, listCentsPerLead: list, centsPerLead: per, discounted });
    listCents += list * it.quantity;
    subtotalCents += per * it.quantity;
    if (discounted) referredLeads += it.quantity;
  }

  let bucks = opts.useBucks ? Math.max(0, Math.min(opts.bucksAvailableCents ?? 0, subtotalCents)) : 0;
  // Never leave a sub-$0.50 card charge: either Bucks cover it all, or leave $0.50.
  const rest = subtotalCents - bucks;
  if (rest > 0 && rest < STRIPE_MIN_CHARGE_CENTS) bucks = Math.max(0, subtotalCents - STRIPE_MIN_CHARGE_CENTS);

  return {
    lines,
    listCents,
    discountCents: listCents - subtotalCents,
    subtotalCents,
    bucksAppliedCents: bucks,
    chargeCents: subtotalCents - bucks,
    referrerEarnsCents: referredLeads * BUCKS_PER_REFERRED_LEAD_CENTS,
  };
}

/** Codes are 4–20 letters/digits, stored uppercase. */
export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}
export const CODE_PATTERN = /^[A-Z0-9]{4,20}$/;
