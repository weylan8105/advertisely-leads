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
  {
    id: "aged-iul",
    name: "Aged IUL Leads",
    tagline: "Real Blue-Collar IUL prospects at a fraction of the price.",
    description:
      "Previously-generated Blue-Collar IUL leads from our Meta campaigns — the same high-intent tradesmen, aged 30+ days. Fully TCPA-consented and deeply discounted for agents who work volume.",
    pricePerLead: 12,
    minimumOrder: 25,
    estimatedDelivery: "Within 24 hours",
    badge: "Available now",
    available: true,
    features: [
      "Same Blue-Collar IUL source",
      "TCPA consent captured",
      "Aged 30+ days",
      "Deeply discounted volume pricing",
    ],
    ideal: [
      "High-volume dialers",
      "Agencies running call nights",
      "Agents testing new scripts",
    ],
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
