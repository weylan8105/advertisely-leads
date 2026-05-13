import type { LeadPackage } from "@/types";

export const leadPackages: LeadPackage[] = [
  {
    id: "blue-collar-iul",
    name: "Blue-Collar IUL Leads",
    tagline: "Working professionals who actually pick up.",
    description:
      "Union members, tradesmen, and W-2 earners actively asking about cash-value life insurance and tax-free income strategies. Currently the only package we deliver live.",
    pricePerLead: 30,
    minimumOrder: 20,
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
    niches: ["Lineman", "Electrician", "Plumber", "Pipefitter", "Nurse"],
  },
  {
    id: "fresh-iul",
    name: "Fresh IUL Leads",
    tagline: "Real-time. High intent. Closer-ready.",
    description:
      "Brand new IUL prospects sourced from Meta campaigns. Delivered within minutes of opt-in with full TCPA consent capture.",
    pricePerLead: 32,
    minimumOrder: 15,
    estimatedDelivery: "Real-time (under 5 min)",
    freshnessHours: 1,
    badge: "Coming soon",
    available: false,
    comingSoonNote: "Real-time delivery pipeline launching next.",
    features: [
      "Real-time delivery",
      "TCPA consent captured",
      "Source + campaign tracking",
      "TrustedForm / Jornaya certificate",
    ],
    ideal: [
      "Agents with active dialer setup",
      "Agency builders running call nights",
      "Tax-free retirement scripts",
    ],
    niches: ["Tax-free retirement", "401k rollover", "College savings"],
  },
  {
    id: "retirement-iul",
    name: "Retirement-Focused IUL Leads",
    tagline: "Pre-retirees asking the right questions.",
    description:
      "Age 45-65 prospects researching tax-free retirement, IUL vs. 401k, and Roth alternatives. Average household income $90k+.",
    pricePerLead: 38,
    minimumOrder: 10,
    estimatedDelivery: "Real-time",
    badge: "Coming soon",
    available: false,
    comingSoonNote: "Campaign creative in pre-launch QA.",
    features: [
      "Age-qualified 45-65",
      "Household income $90k+",
      "IUL vs 401k intent",
      "Higher AP potential",
    ],
    ideal: [
      "Retirement planning scripts",
      "Tax-free income presentations",
      "Annuity cross-sell builders",
    ],
    niches: ["Tax-free retirement", "Roth alternative", "Pension max"],
  },
  {
    id: "mortgage-iul",
    name: "Mortgage Protection to IUL Cross-Sell",
    tagline: "Warm MP leads pre-screened for IUL conversion.",
    description:
      "Homeowners who originally inquired about mortgage protection but expressed interest in cash-value and retirement planning during qualification.",
    pricePerLead: 26,
    minimumOrder: 20,
    estimatedDelivery: "Within 24 hours",
    badge: "Coming soon",
    available: false,
    comingSoonNote: "Adding MP qualification step to capture flow.",
    features: [
      "Homeowner verified",
      "Soft mortgage data",
      "Pre-screened IUL intent",
      "Lower CPL, higher volume",
    ],
    ideal: [
      "MP/IUL hybrid agencies",
      "Door-knock + dial teams",
      "New agent training pipelines",
    ],
    niches: ["Homeowners", "Family protection", "New movers"],
  },
  {
    id: "aged-iul",
    name: "Aged IUL Leads",
    tagline: "Volume pricing for dialer-heavy teams.",
    description:
      "IUL prospects aged 30-90 days. Lower cost per lead, perfect for high-velocity dialer teams running disciplined follow-up cadences.",
    pricePerLead: 6,
    minimumOrder: 100,
    estimatedDelivery: "Instant download",
    badge: "Coming soon",
    available: false,
    comingSoonNote: "Inventory building — available once Fresh pipeline ages.",
    features: [
      "30-90 day aged",
      "Bulk CSV delivery",
      "Original consent preserved",
      "Volume discounts",
    ],
    ideal: [
      "Power dialer teams",
      "Agent training & rookies",
      "List-stacking workflows",
    ],
    niches: ["Mixed niches", "All age bands"],
  },
];

export function findPackage(id: string) {
  return leadPackages.find((p) => p.id === id);
}
