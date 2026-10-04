// The ONLY reasons a lead is eligible for replacement (matches our published
// policy / competitor parity). Shared by the request UI and the API so the two
// never drift. Not eligible: no-answer, voicemail, wrong number/info, opt-out
// claims, free leads — those are the nature of raw consumer inquiries.
export const ELIGIBLE_REPLACEMENT_REASONS = [
  {
    code: "disconnected",
    label: "Disconnected number",
    help: "The phone number is disconnected (verified by our team on review).",
  },
  {
    code: "duplicate",
    label: "Duplicate lead",
    help: "A duplicate of a lead you already received within the last 60 days.",
  },
  {
    code: "over_age",
    label: "Over the age limit",
    help: "The prospect is over the maximum issue age (85+).",
  },
  {
    code: "out_of_state",
    label: "Wrong state (out of territory)",
    help: "The lead is outside the states on your order.",
  },
] as const;

export type ReplacementReasonCode = (typeof ELIGIBLE_REPLACEMENT_REASONS)[number]["code"];

export const ELIGIBLE_REASON_CODES = ELIGIBLE_REPLACEMENT_REASONS.map((r) => r.code);

export function isEligibleReasonCode(code: unknown): code is ReplacementReasonCode {
  return typeof code === "string" && (ELIGIBLE_REASON_CODES as string[]).includes(code);
}

export function reasonLabel(code: string): string {
  return ELIGIBLE_REPLACEMENT_REASONS.find((r) => r.code === code)?.label ?? code;
}

// Short human sentence for the "not eligible" guidance shown to clients.
export const REPLACEMENT_NOT_ELIGIBLE_NOTE =
  "Not eligible: no-answer, voicemail, wrong number/info, or opt-out claims. Replacements are capped at 20% of each order.";

// Explicitly NOT eligible — shown in the policy block so clients know before they
// submit what will be denied.
export const NOT_ELIGIBLE_REPLACEMENT_REASONS = [
  "No-answers / voicemails / unresponsive numbers",
  "Wrong number or wrong information",
  "Not interested / opted out / claims never submitted",
  "Duplicates received more than 60 days apart",
  "Free / promotional leads",
] as const;

// The window and cap, shown alongside the policy.
export const REPLACEMENT_WINDOW_NOTE =
  "Flag within 72 hours of your order filling. All requests are verified on review. Replacements are capped at 20% of each order.";
