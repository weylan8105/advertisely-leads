// Age display helpers. Many Meta lead forms ask an age RANGE ("40–49", "50+",
// "18-29") rather than a number, so the numeric Lead.age is often null/0. The
// real range is preserved in rawFormData — surface it so agents always see the
// prospect's age, not a blank.

/**
 * Pull the age-range string out of a lead's rawFormData. Prefers the normalized
 * `ageRange` key (set by the pool importer / CSV intake) and otherwise falls
 * back to any answer whose question mentions "age" and contains a digit
 * (covers Meta webhook leads keyed by the raw question text).
 */
export function ageRangeFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const direct = obj.ageRange;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  for (const [k, v] of Object.entries(obj)) {
    if (/age/i.test(k) && typeof v === "string" && /\d/.test(v)) return v.trim();
  }
  return null;
}

/**
 * What to render in an "Age" field: the captured range if we have one, else the
 * numeric age, else an em dash.
 */
export function formatAge(lead: { age?: number | null; ageRange?: string | null; rawFormData?: unknown }): string {
  const range = lead.ageRange ?? ageRangeFromRaw(lead.rawFormData);
  if (range) return range;
  return lead.age && lead.age > 0 ? String(lead.age) : "—";
}
