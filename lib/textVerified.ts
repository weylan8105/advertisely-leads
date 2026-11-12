// "Text verified" leads: the lead confirmed their phone number with a one-time
// code texted by Meta (the instant form's SMS check), so the number is real and
// theirs. Meta doesn't flag this on the lead itself, so we key it on the FORM the
// lead submitted: only forms with the SMS check turned on count. (Keying on the
// ad was wrong: an ad keeps its id when it's moved to a new form, so its leads
// from the older, unverified form got the badge too.)
//
// To badge a new form's leads, add its Meta form id here.

export const TEXT_VERIFIED_FORM_IDS = new Set<string>([
  "1519246773375371", // EWWS - Nurse Lead Form 11/11 - SMS Verified
  "1405276628037816", // EWWS - Nurse Lead Form 11/11 v2 - LP Questions + SMS Verified
  "1453178320339815", // EWWS - Blue Collar Lead Form 11/11 v2 - LP Questions + SMS Verified
  "1491493996376938", // EW - Blue Collar Lead Form 11/11 - LP Questions + SMS Verified (Enhanced Wealth page)
]);

function asObject(value: unknown): Record<string, unknown> | null {
  let obj = value;
  if (typeof value === "string") {
    try {
      obj = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return obj && typeof obj === "object" && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
}

/**
 * The Meta form a lead was submitted on, from its raw data. GHL forwards it in
 * the attribution (`lastAttributionSource` is the submission that sent the
 * lead; `attributionSource` is the contact's first touch); a direct Meta lead
 * may carry it at the top level.
 */
export function leadFormId(rawFormData: unknown): string {
  const raw = asObject(rawFormData);
  if (!raw) return "";
  const contact = asObject(raw.contact);
  for (const src of [raw.lastAttributionSource, contact?.lastAttributionSource, raw.attributionSource, contact?.attributionSource]) {
    const id = asObject(src)?.formId;
    if (id) return String(id).trim();
  }
  for (const key of ["formId", "form_id"]) {
    const id = raw[key];
    if (typeof id === "string" || typeof id === "number") return String(id).trim();
  }
  return "";
}

/** True when the lead came in on a form that makes people confirm their number by text. */
export function isTextVerified(lead: { rawFormData?: unknown }): boolean {
  const id = leadFormId(lead.rawFormData);
  return !!id && TEXT_VERIFIED_FORM_IDS.has(id);
}
