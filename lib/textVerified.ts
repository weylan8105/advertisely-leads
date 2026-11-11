// "Text verified" leads: the lead confirmed their phone number with a one-time
// code texted by Meta (the instant form's SMS check), so the number is real and
// theirs. Meta doesn't flag this on the lead itself, so we key it on the ads
// whose form has the check turned on. Add an ad's id (Lead.creativeId) here to
// badge its leads; ids survive the ad being renamed.

export const TEXT_VERIFIED_AD_IDS = new Set<string>([
  "120249710045080601", // 11/08/26 - AI Nurse ad 3 - Why Work Until 65 (Ryan, Nov 11)
]);

/** True when the lead came from an ad whose form makes people confirm their number by text. */
export function isTextVerified(lead: { creativeId?: string | null }): boolean {
  const id = String(lead.creativeId ?? "").trim();
  return !!id && TEXT_VERIFIED_AD_IDS.has(id);
}
