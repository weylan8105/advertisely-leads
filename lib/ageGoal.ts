/**
 * Age x goal knockout (owner, Nov 23 2026).
 *
 * Over 55 and mainly after early retirement / cash value = a poor lead, so it is
 * knocked out. Over 55 and after a death benefit (family protection, illness
 * benefits, or "help understanding all of these") stays: those are good leads.
 * 55 and under can pick anything.
 */
export const AGE_GOAL_MAX_RETIREMENT_AGE = 55;

// The "what matters most" answers that mean retirement / cash value, on every form.
const RETIREMENT_GOAL = /retire|cash value|policy loans/i;

const GOAL_KEYS = ["quiz_iul_interest", "intent", "What about IUL caught your attention most?", "What matters most to you?"];
const AGE_KEYS = ["age", "quiz_age", "What's your age?"];

export function isRetirementGoal(answer: string): boolean {
  return RETIREMENT_GOAL.test(answer);
}

/** true when the answers say over 55 and wanting retirement / cash value. */
export function isAgeGoalKnockout(raw: Record<string, unknown>): boolean {
  const goals = GOAL_KEYS.map((k) => String(raw[k] ?? "").trim()).filter(Boolean);
  if (!goals.some(isRetirementGoal)) return false;
  return AGE_KEYS.some((k) => parseInt(String(raw[k] ?? ""), 10) > AGE_GOAL_MAX_RETIREMENT_AGE);
}

/**
 * true when the lead answered the "what matters most" question with a death-benefit
 * goal (family protection, living/illness benefits, "all of the above", "help
 * understanding all of these"): anything answered that isn't retirement / cash value.
 * false when the answer is retirement / cash value or the question wasn't answered.
 */
export function isDeathBenefitGoal(raw: Record<string, unknown>): boolean {
  const goals = GOAL_KEYS.map((k) => String(raw[k] ?? "").trim()).filter(Boolean);
  return goals.length > 0 && !goals.some(isRetirementGoal);
}
