/**
 * Lead types an advertiser can switch on from their dashboard. Blue Collar leads
 * from the shared pool come to every advertiser; the types here only go to those
 * who turned them on (User.leadTypes). Ids are Lead.packageId values.
 */
export interface OptInLeadType {
  id: string;
  label: string;
  description: string;
  launchedAt: string; // YYYY-MM-DD
}

export const OPT_IN_LEAD_TYPES: OptInLeadType[] = [
  {
    id: "healthcare-iul",
    label: "Nurse leads",
    description:
      "Nurses and healthcare workers from our Essential Workers campaign, charged from your ad spend like your other leads.",
    launchedAt: "2026-11-16",
  },
];

export const NURSE_LEAD_TYPE = "healthcare-iul";

export const isOptInLeadType = (id: string) => OPT_IN_LEAD_TYPES.some((t) => t.id === id);

/** Keep only known opt-in ids, once each. */
export const cleanLeadTypes = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.map(String).filter(isOptInLeadType))] : [];
