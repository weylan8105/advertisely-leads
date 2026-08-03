import type { LeadPackage, ProductGroup } from "@/types";

// The IUL lead pool spans two historical packageId labels — `blue-collar-iul`
// (what GHL intake stamps on new leads) and `aged-iul` (existing stock). They're
// the same IUL leads, so the age-tiered store below sells across both, priced by
// how old each lead is. Any IUL lead is sellable in exactly one tier by its age.
export const IUL_POOL_IDS = ["blue-collar-iul", "aged-iul"];

export const leadPackages: LeadPackage[] = [
  // ── Hidden pool entries (not sold directly; used for lead-label resolution
  //    and as the underlying pool the age tiers draw from) ──────────────
  {
    id: "blue-collar-iul",
    name: "Blue-Collar IUL Leads",
    tagline: "Working professionals who actually pick up.",
    description: "Union members, tradesmen, and W-2 earners asking about cash-value life insurance.",
    pricePerLead: 45,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    available: true,
    hidden: true,
    features: [],
    ideal: [],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "aged-iul",
    name: "Aged IUL Leads",
    tagline: "Real Blue-Collar IUL prospects at a fraction of the price.",
    description: "Previously-generated Blue-Collar IUL leads, sold by age at a discount.",
    pricePerLead: 12,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    available: true,
    hidden: true,
    features: [],
    ideal: [],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },

  // ── IUL age ladder ─────────────────────────────────────────────────
  // Priced by lead age. Windows tile with an exclusive upper edge (`ageMaxDays`,
  // shared with the next tier's `ageMinDays`) so no lead falls between tiers.
  // Minimum order = 25 leads floor, raised only where needed to reach $150 of
  // leads → minimumOrder = max(25, ceil(150 / price)). So only the $3 (150+) tier exceeds 25.
  {
    id: "iul-fresh",
    name: "Fresh IUL — under 48 hours",
    tagline: "The freshest leads on the platform — generated to order, always available.",
    description:
      "Blue-Collar IUL prospects generated within the last 48 hours. Generated fresh to order, so this tier is never out of stock. Highest contact and conversion rates.",
    pricePerLead: 45,
    minimumOrder: 25, // max(25, ceil(150/45)=4) = 25
    estimatedDelivery: "Within 24 hours",
    badge: "Freshest",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 0,
    ageMaxDays: 2,
    features: ["Under 48 hours old", "Highest answer rate", "TCPA consent captured", "Full source attribution"],
    ideal: ["Speed-to-lead callers", "Closers who work fresh intent", "Agencies with live floors"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "iul-2-5",
    name: "IUL — 2–5 days",
    tagline: "Just past fresh, still highly responsive.",
    description: "Blue-Collar IUL prospects aged 2–5 days. Near-fresh answer rates at a lower price.",
    pricePerLead: 35,
    minimumOrder: 25, // max(25, ceil(150/35)=5) = 25
    estimatedDelivery: "Within 24 hours",
    badge: "Nearly fresh",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 2,
    ageMaxDays: 6,
    features: ["2–5 days old", "TCPA consent captured", "Near-fresh answer rates", "Full source attribution"],
    ideal: ["Speed-to-lead callers", "Closers", "Agencies with live floors"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "iul-6-29",
    name: "IUL — 6–29 days",
    tagline: "Recent leads at a fraction of fresh pricing.",
    description: "Blue-Collar IUL prospects aged 6–29 days. Strong value for consistent dialers.",
    pricePerLead: 22,
    minimumOrder: 25, // max(25, ceil(150/22)=7) = 25
    estimatedDelivery: "Within 24 hours",
    badge: "Best value",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 6,
    ageMaxDays: 30,
    features: ["6–29 days old", "TCPA consent captured", "Deep discount vs fresh", "Great answer rates"],
    ideal: ["High-volume dialers", "Agencies running call nights", "Agents testing scripts"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "iul-30-44",
    name: "IUL — 30–44 days",
    tagline: "A month old, priced to move volume.",
    description: "Blue-Collar IUL prospects aged 30–44 days. Volume value for hard-dialing teams.",
    pricePerLead: 12,
    minimumOrder: 25, // max(25, ceil(150/12)=13) = 25
    estimatedDelivery: "Within 24 hours",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 30,
    ageMaxDays: 45,
    features: ["30–44 days old", "TCPA consent captured", "Deep volume pricing", "Same IUL source"],
    ideal: ["High-volume dialers", "Call floors", "Script testing"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "iul-45-89",
    name: "IUL — 45–89 days",
    tagline: "Aged and deeply discounted for scale.",
    description: "Blue-Collar IUL prospects aged 45–89 days. Rock-bottom pricing for high-volume floors.",
    pricePerLead: 9,
    minimumOrder: 25, // max(25, ceil(150/9)=17) = 25
    estimatedDelivery: "Within 24 hours",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 45,
    ageMaxDays: 90,
    features: ["45–89 days old", "TCPA consent captured", "Rock-bottom pricing", "Same IUL source"],
    ideal: ["High-volume dialers", "Call floors at scale", "Reactivation campaigns"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "iul-90-150",
    name: "IUL — 90–150 days",
    tagline: "Deeply discounted for high-volume floors.",
    description: "Blue-Collar IUL prospects aged 90–150 days. Deep discount for teams that dial at scale.",
    pricePerLead: 6,
    minimumOrder: 25, // max(25, ceil(150/6)=25) = 25
    estimatedDelivery: "Within 24 hours",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 90,
    ageMaxDays: 150,
    features: ["90–150 days old", "TCPA consent captured", "Deep volume pricing", "Same IUL source"],
    ideal: ["Bulk dialers", "Reactivation & nurture", "High-volume floors"],
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter"],
  },
  {
    id: "iul-150plus",
    name: "IUL — 150+ days",
    tagline: "Our deepest discount — pennies per lead.",
    description: "Blue-Collar IUL prospects aged 150 days and older. The lowest per-lead price we offer. (No inventory yet — fills as leads age past 150 days.)",
    pricePerLead: 3,
    minimumOrder: 50, // max(25, ceil(150/3)=50) = 50
    estimatedDelivery: "Within 24 hours",
    badge: "Lowest price",
    available: true,
    leadPackageId: "aged-iul",
    ageMinDays: 150,
    features: ["150+ days old", "TCPA consent captured", "Deepest discount", "Same IUL source"],
    ideal: ["Bulk dialers", "Reactivation & nurture", "Pennies-per-lead volume"],
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

/**
 * Lead pools a purchasable draws from. IUL age tiers span the whole IUL pool
 * (both the `blue-collar-iul` and `aged-iul` labels) so any IUL lead is sellable
 * by its age; everything else draws from its own single pool.
 */
export function leadPoolIdsFor(id: string): string[] {
  const primary = findPackage(id)?.leadPackageId ?? id;
  return IUL_POOL_IDS.includes(primary) ? [...IUL_POOL_IDS] : [primary];
}

/** Purchasable ids that a lead in the given pool could fulfill. */
export function purchasableIdsForPool(poolId: string): string[] {
  const pools = IUL_POOL_IDS.includes(poolId) ? IUL_POOL_IDS : [poolId];
  return leadPackages.filter((p) => pools.includes(p.leadPackageId ?? p.id)).map((p) => p.id);
}

// ── Marketing-angle product groups ───────────────────────────────────
// The marketplace shows ONE product per group with its age tiers as
// subcategories, rather than a flat wall of price points.
export const productGroups: ProductGroup[] = [
  {
    id: "iul",
    name: "Blue Collar IUL Leads",
    tagline: "Tax-free retirement prospects who raised their hand.",
    blurb:
      "Blue-collar W-2 earners and tradesmen who responded to a tax-free, tax-advantaged early-retirement offer — high-intent prospects looking to retire sooner and keep more of what they earn. Start with fresh leads for the highest contact rates, or go older for deep volume discounts.",
    available: true,
  },
  {
    id: "term",
    name: "Term Life Leads",
    tagline: "High-intent prospects shopping for term coverage.",
    blurb:
      "Families and individuals actively researching term life insurance — ideal for agents who convert term to permanent.",
    available: false,
    comingSoonNote: "Term campaign launching soon.",
  },
];

/** Which marketing group a purchasable belongs to (explicit `group`, else derived). */
export function groupIdFor(pkg: LeadPackage): string {
  return pkg.group ?? (pkg.id === "term-leads" ? "term" : "iul");
}

/** Visible, purchasable tiers within a group, cheapest-age-first ordering preserved. */
export function tiersForGroup(groupId: string): LeadPackage[] {
  return leadPackages.filter((p) => !p.hidden && groupIdFor(p) === groupId);
}
