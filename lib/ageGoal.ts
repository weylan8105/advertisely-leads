/**
 * Hard age cutoff (owner, Nov 23 2026): we no longer generate leads over 55.
 * Anyone 56 or older is knocked out, whatever their goal. This replaces the
 * earlier age x goal rule (which let over-55 death-benefit seekers through).
 */
export const MAX_LEAD_AGE = 55;

const AGE_KEYS = ["age", "quiz_age", "What's your age?"];

/** Age in whole years on `today` from a date of birth, or null if it can't be read. */
export function ageFromDob(raw: unknown, today: Date = new Date()): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); // 1990-05-12, 1990-05-12T00:00:00Z
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // 05/12/1990 (Meta lead export)
  if (iso) [y, m, d] = [+iso[1], +iso[2], +iso[3]];
  else if (us) [y, m, d] = [+us[3], +us[1], +us[2]];
  else if (/^-?\d{9,13}$/.test(s)) {
    // epoch seconds or milliseconds
    const dt = new Date(s.length > 11 ? +s : +s * 1000);
    if (isNaN(dt.getTime())) return null;
    [y, m, d] = [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  let age = today.getUTCFullYear() - y;
  const mm = today.getUTCMonth() + 1;
  if (mm < m || (mm === m && today.getUTCDate() < d)) age--;
  return age >= 0 && age < 130 ? age : null;
}

/** The date-of-birth answer on a lead (Meta's "Date of birth" field, via GHL or direct). */
export function dobAnswer(raw: Record<string, unknown>): string | null {
  for (const key of Object.keys(raw)) {
    if (!/^(date[\s_]*of[\s_]*birth|dob|dateofbirth|birth[\s_]*date|birthday)$/i.test(key)) continue;
    const v = String(raw[key] ?? "").trim();
    if (v) return v;
  }
  return null;
}

/** true when the answers say the person is over 55 (typed age or date of birth). */
export function isOverAgeKnockout(raw: Record<string, unknown>): boolean {
  if (AGE_KEYS.some((k) => parseInt(String(raw[k] ?? ""), 10) > MAX_LEAD_AGE)) return true;
  const dobAge = ageFromDob(dobAnswer(raw));
  return dobAge != null && dobAge > MAX_LEAD_AGE;
}
