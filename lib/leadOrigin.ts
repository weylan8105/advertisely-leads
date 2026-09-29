// Classifies where a lead came from so the CRM can title it clearly:
//   - "funnel": an automated lead from our own American Blue Collar Advantage
//     quiz funnel (posted to the inbound webhook). Titled "American Income
//     Advantage Lead" per Ryan's naming.
//   - "import": an Enhanced Wealth lead loaded through the admin CSV importer
//     (or any non-funnel source). Titled "Enhanced Wealth Lead".
//
// The distinction is by data signals we already store — no schema change:
// funnel leads carry a funnel `source`/`lead_source`, a quiz_* answer, or a
// landing_url on our funnel domain. Everything else is treated as a manual
// Enhanced Wealth import.

export type LeadOriginKind = "funnel" | "import";

export const FUNNEL_LEAD_LABEL = "American Income Advantage Lead";
export const IMPORT_LEAD_LABEL = "Enhanced Wealth Lead";

// Substrings that mark a lead as coming from our own funnel.
const FUNNEL_SOURCE_MARKERS = ["early-retirement-quiz", "abca-quiz", "abca", "american-blue-collar"];

export function leadOrigin(
  source?: string | null,
  rawFormData?: unknown,
): LeadOriginKind {
  const raw = (rawFormData && typeof rawFormData === "object" && !Array.isArray(rawFormData)
    ? rawFormData
    : {}) as Record<string, unknown>;
  const src = String(source ?? "").toLowerCase();
  const rawSrc = String(raw["lead_source"] ?? raw["source"] ?? "").toLowerCase();
  const landing = String(raw["landing_url"] ?? "").toLowerCase();
  const hasQuizAnswer = Object.keys(raw).some((k) => k.toLowerCase().startsWith("quiz_"));

  const isFunnel =
    FUNNEL_SOURCE_MARKERS.some((m) => src.includes(m) || rawSrc.includes(m)) ||
    landing.includes("americanbluecollaradvantage") ||
    hasQuizAnswer;

  return isFunnel ? "funnel" : "import";
}

/** Human title for the lead's origin, shown on the lead card and DB table. */
export function leadOriginLabel(
  source?: string | null,
  rawFormData?: unknown,
): string {
  return leadOrigin(source, rawFormData) === "funnel" ? FUNNEL_LEAD_LABEL : IMPORT_LEAD_LABEL;
}
