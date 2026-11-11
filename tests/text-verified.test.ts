import { describe, it, expect } from "vitest";
import { isTextVerified, leadFormId } from "@/lib/textVerified";
import { serializeLead } from "@/lib/serialize";

const SMS_FORM = "1405276628037816"; // Nurse v2 - LP Questions + SMS Verified
const OLD_FORM = "1143083241820304"; // Nurse 11/09, no SMS check
const AD_3 = "120249710045080601"; // ran on both forms

const ghl = (formId: string) => ({
  attributionSource: JSON.stringify({ medium: "facebook", formId, formName: "x" }),
});

describe("text verified leads", () => {
  it("badges leads by the form they submitted, not the ad", () => {
    expect(isTextVerified({ rawFormData: ghl(SMS_FORM) })).toBe(true);
    expect(isTextVerified({ rawFormData: ghl("1519246773375371") })).toBe(true);
    expect(isTextVerified({ rawFormData: ghl("1453178320339815") })).toBe(true); // Blue Collar SMS
    expect(isTextVerified({ rawFormData: ghl("1444916353834638") })).toBe(false); // Blue Collar v2, no SMS
    // Same ad, older form without the SMS check: no badge.
    expect(isTextVerified({ rawFormData: ghl(OLD_FORM) })).toBe(false);
    expect(isTextVerified({ rawFormData: {} })).toBe(false);
    expect(isTextVerified({})).toBe(false);
  });

  it("prefers the submission that sent the lead over the first touch", () => {
    const raw = {
      attributionSource: { formId: OLD_FORM },
      lastAttributionSource: { formId: SMS_FORM },
    };
    expect(leadFormId(raw)).toBe(SMS_FORM);
    expect(isTextVerified({ rawFormData: raw })).toBe(true);
    expect(leadFormId({ form_id: SMS_FORM })).toBe(SMS_FORM);
    expect(leadFormId({ attributionSource: "not json" })).toBe("");
  });

  it("reaches the lead card through serializeLead", () => {
    const base = { id: "l1", name: "A", phone: "1", email: "", state: "TX", source: "facebook", consentMethod: "TCPA_WEB_FORM", status: "NEW", creativeId: AD_3 };
    expect(serializeLead({ ...base, rawFormData: ghl(SMS_FORM) }).textVerified).toBe(true);
    expect(serializeLead({ ...base, rawFormData: ghl(OLD_FORM) }).textVerified).toBeUndefined();
  });
});
