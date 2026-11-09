// Backstop classifier that keeps nurse / healthcare-worker leads out of the
// Blue-Collar IUL pool.
//
// Nurse leads come from the Essential Workers Wealth Solutions "Nurses" instant
// form and the Healthcare Wealth Advantage (HWA) funnel. Their campaign / source
// names carry the signal (e.g. "EWWS - Nurses - Instant Form", "HWA ..."), but the
// upstream connector (Make/Zapier/GHL) does NOT reliably stamp `package_id`, so
// those leads silently default to `blue-collar-iul`. This classifies them from
// attribution as the server-side backstop so the connector can't mislabel them.
//
// It is deliberately conservative: only UPGRADES a lead from the IUL pool
// (blue-collar / aged) or an empty/unknown package to Healthcare IUL. An already
// healthcare lead stays healthcare, and an explicit non-IUL package (e.g. trucker)
// is never clobbered. "EWWS - Blue Collar ..." carries no healthcare marker, so it
// correctly stays Blue-Collar IUL.

import { IUL_POOL_IDS } from "@/data/packages";

export const HEALTHCARE_PACKAGE_ID = "healthcare-iul";

// Strong, unambiguous markers (case-insensitive substring match).
const HEALTHCARE_MARKERS = ["nurse", "nursing", "healthcare", "health care", "health-care", "medical"];
// Short codes that must match as whole words, so "rn" doesn't fire on "Turner"
// and "hwa" doesn't fire on "highway".
const HEALTHCARE_WORD_CODES = ["hwa", "rn", "lpn", "lvn", "cna"];

/** True when any of the given attribution strings reads as a nurse/healthcare lead. */
export function looksHealthcare(...fields: (string | null | undefined)[]): boolean {
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  if (!hay) return false;
  if (HEALTHCARE_MARKERS.some((m) => hay.includes(m))) return true;
  return HEALTHCARE_WORD_CODES.some((w) => new RegExp(`\\b${w}\\b`).test(hay));
}

export interface HealthcareSignals {
  campaign?: string | null;
  utmCampaign?: string | null;
  source?: string | null;
  formName?: string | null;
  occupation?: string | null;
}

/**
 * Upgrade a resolved packageId to Healthcare IUL when the lead's attribution shows
 * a nurse/healthcare funnel. Only upgrades from the IUL pool or an empty/unknown
 * package; leaves an already-healthcare or explicit non-IUL package untouched.
 */
export function resolveHealthcarePackage(packageId: string, signals: HealthcareSignals): string {
  if (packageId === HEALTHCARE_PACKAGE_ID) return packageId;
  const upgradeable = !packageId || IUL_POOL_IDS.includes(packageId);
  if (!upgradeable) return packageId;
  return looksHealthcare(
    signals.campaign,
    signals.utmCampaign,
    signals.source,
    signals.formName,
    signals.occupation,
  )
    ? HEALTHCARE_PACKAGE_ID
    : packageId;
}
