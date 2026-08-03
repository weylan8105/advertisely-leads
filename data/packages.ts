import type { LeadPackage } from "@/types";

export const leadPackages: LeadPackage[] = [
  {
    id: "blue-collar-iul",
    name: "Blue-Collar IUL Leads",
    tagline: "Working professionals who actually pick up.",
    description:
      "Union members, tradesmen, and W-2 earners actively asking about cash-value life insurance and tax-free income strategies. Currently the only package we deliver live.",
    pricePerLead: 45,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    badge: "Available now",
    available: true,
    features: [
      "Income-qualified ($55k+ W-2)",
      "Trade & union niches",
      "Filtered for pension supplement intent",
      "Mobile-first lead form",
    ],
    ideal: [
      "Trade union recruiters",
      "Pension-supplement scripts",
      "Agencies running PHP/IUL hybrid",
    ],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  // ── Aged IUL store ─────────────────────────────────────────────────
  // The raw aged pool. Hidden from the marketplace grid; kept so lead labels
  // ("Aged IUL Leads") still resolve. All three buckets below sell from it,
  // filtered by age window (`ageMinDays`/`ageMaxDays`). Prices step down with
  // age and are easy to tune here.
  {
    id: "aged-iul",
    name: "Aged IUL Leads",
    tagline: "Real Blue-Collar IUL prospects at a fraction of the price.",
    description:
      "Previously-generated Blue-Collar IUL leads — the same high-intent tradesmen, sold by age at a discount.",
    pricePerLead: 12,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    available: true,
    hidden: true,
    features: [],
    ideal: [],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "aged-iul-0-14",
    name: "Aged IUL — Recent (0–14 days)",
    tagline: "Freshest of the aged pool — barely a couple weeks old.",
    description:
      "Blue-Collar IUL prospects generated within the last 14 days. The most responsive aged tier, at a fraction of fresh pricing.",
    pricePerLead: 12,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    badge: "Best answer rates",
    available: true,
    leadPackageId: "aged-iul",
    // Windows tile contiguously: ageMaxDays is the exclusive upper edge (shared
    // with the next bucket's ageMinDays) so no lead falls between tiers.
    ageMinDays: 0,
    ageMaxDays: 15,
    features: [
      "Same Blue-Collar IUL source",
      "TCPA consent captured",
      "0–14 days old",
      "Highest contact rate of the aged tiers",
    ],
    ideal: ["High-volume dialers", "Agencies running call nights", "Agents testing new scripts"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "aged-iul-15-30",
    name: "Aged IUL — 15–30 days",
    tagline: "Two-to-four weeks old at a deeper discount.",
    description:
      "Blue-Collar IUL prospects aged 15–30 days. Great volume value for teams that dial hard.",
    pricePerLead: 9,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    badge: "Best value",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 15,
    ageMaxDays: 31,
    features: ["Same Blue-Collar IUL source", "TCPA consent captured", "15–30 days old", "Deep volume pricing"],
    ideal: ["High-volume dialers", "Agencies running call nights", "Agents testing new scripts"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "aged-iul-31plus",
    name: "Aged IUL — 31+ days",
    tagline: "Our deepest discount for high-volume call floors.",
    description:
      "Blue-Collar IUL prospects aged 31 days and older. Lowest per-lead price for agents who work volume at scale.",
    pricePerLead: 6,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    badge: "Lowest price",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 31,
    features: ["Same Blue-Collar IUL source", "TCPA consent captured", "31+ days old", "Rock-bottom volume pricing"],
    ideal: ["High-volume dialers", "Agencies running call nights", "Agents testing new scripts"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "term-leads",
    name: "Term Life Leads",
    tagline: "High-intent prospects shopping for term coverage.",
    description:
      "Families and individuals actively researching term life insurance. Pre-qualified for coverage need and budget — ideal for agents who convert term to permanent.",
    pricePerLead: 30,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    badge: "Coming soon",
    available: false,
    comingSoonNote: "Term campaign launching soon.",
    features: [
      "Coverage-intent verified",
      "TCPA consent captured",
      "Budget pre-qualified",
      "TrustedForm certificate",
    ],
    ideal: [
      "Term-to-perm conversion scripts",
      "Family protection agents",
      "Agencies building volume",
    ],
    niches: ["Families", "Young professionals", "Breadwinners"],
  },
];

export function findPackage(id: string) {
  return leadPackages.find((p) => p.id === id);
}

/** The underlying lead pool a purchasable draws from (buckets → their pool). */
export function leadPoolFor(id: string): string {
  return findPackage(id)?.leadPackageId ?? id;
}

/** All purchasable ids (buckets + pool entry) that draw from a given lead pool. */
export function purchasableIdsForPool(poolId: string): string[] {
  return leadPackages.filter((p) => (p.leadPackageId ?? p.id) === poolId).map((p) => p.id);
}
