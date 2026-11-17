/**
 * Lead types an advertiser can switch on or off from their dashboard
 * (User.leadTypes). Ids are Lead.packageId values.
 *
 *  - Blue Collar is ON unless switched off (stored as "-blue-collar-iul"), so
 *    every advertiser keeps getting it without doing anything.
 *  - Nurse is OFF unless switched on (stored as "healthcare-iul").
 *
 * The shared pool (lib/sharedPool.ts) only gives an advertiser a lead whose
 * type they have on.
 */
export interface LeadTypeOption {
  id: string;
  label: string;
  description: string;
  defaultOn: boolean;
  isNew?: boolean;
}

export const BLUE_COLLAR_LEAD_TYPE = "blue-collar-iul";
export const NURSE_LEAD_TYPE = "healthcare-iul";

export const LEAD_TYPE_OPTIONS: LeadTypeOption[] = [
  {
    id: BLUE_COLLAR_LEAD_TYPE,
    label: "Blue Collar leads",
    description: "Blue-collar workers from our Enhanced Wealth, ABCA and Essential Workers campaigns.",
    defaultOn: true,
  },
  {
    id: NURSE_LEAD_TYPE,
    label: "Nurse leads",
    description:
      "Nurses and healthcare workers from our Essential Workers campaign, charged from your ad spend like your other leads.",
    defaultOn: false,
    isNew: true,
  },
];

const OFF = (id: string) => `-${id}`;

/** Does this advertiser take this lead type? */
export function leadTypeOn(stored: string[] | null | undefined, id: string): boolean {
  const t = LEAD_TYPE_OPTIONS.find((x) => x.id === id);
  if (!t) return false;
  const s = stored ?? [];
  return t.defaultOn ? !s.includes(OFF(id)) : s.includes(id);
}

/** The ids switched on, for the dashboard. */
export const enabledLeadTypes = (stored: string[] | null | undefined): string[] =>
  LEAD_TYPE_OPTIONS.filter((t) => leadTypeOn(stored, t.id)).map((t) => t.id);

/** What to store for a set of switched-on ids (unknown ids are ignored). */
export function storedLeadTypes(enabled: unknown): string[] {
  const on = new Set(Array.isArray(enabled) ? enabled.map(String) : []);
  return LEAD_TYPE_OPTIONS.flatMap((t) => (t.defaultOn ? (on.has(t.id) ? [] : [OFF(t.id)]) : on.has(t.id) ? [t.id] : []));
}
