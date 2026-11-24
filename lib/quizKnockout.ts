/**
 * Answer knockouts shared with the instant forms (owner, Nov 23 2026). The quiz pages
 * end on the not-a-fit screen for these, and /api/quiz/submit refuses them too, so a
 * cached old page or a direct post can't get around them.
 *  - monthly budget "Under $300"
 *  - under-$3,000 income branch: "No, it's just me" (no one else helps with the bills)
 *    or "Not right now" (can't set aside $150-$300 a month)
 */
const KNOCKOUTS: { key: RegExp; answers: string[] }[] = [
  { key: /put toward(s)? (an iul|building your tax-free retirement) each month|^monthly_budget$/i, answers: ["Under $300"] },
  { key: /anyone else in your household help with the bills|^household$/i, answers: ["No, it's just me"] },
  { key: /could you set aside \$150.\$300 a month|^set_aside$/i, answers: ["Not right now"] },
];

/** The first knocked-out answer's key, or null when none is. */
export function answerKnockout(raw: Record<string, unknown>): string | null {
  for (const key of Object.keys(raw)) {
    const v = String(raw[key] ?? "").trim();
    if (!v) continue;
    if (KNOCKOUTS.some((k) => k.key.test(key) && k.answers.includes(v))) return key;
  }
  return null;
}
