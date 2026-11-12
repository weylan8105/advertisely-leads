import { describe, it, expect } from "vitest";
import {
  isEwTextVerifiedLead,
  isAbcaLandingPageLead,
  guestLicensedFor,
  isGuestTurn,
} from "@/lib/tempRotationGuest";

const ghl = (formId: string) => ({ lastAttributionSource: { formId } });

describe("temporary guest rotation (Kyle)", () => {
  it("only the Enhanced Wealth OTP form counts as a text-verified EW lead", () => {
    expect(isEwTextVerifiedLead({ rawFormData: ghl("1491493996376938") })).toBe(true);
    // EWWS text-verified forms stay with the house.
    expect(isEwTextVerifiedLead({ rawFormData: ghl("1453178320339815") })).toBe(false);
    expect(isEwTextVerifiedLead({ rawFormData: ghl("1405276628037816") })).toBe(false);
    // Older Enhanced Wealth forms without the text check.
    expect(isEwTextVerifiedLead({ rawFormData: ghl("1721027025846342") })).toBe(false);
    expect(isEwTextVerifiedLead({ rawFormData: {} })).toBe(false);
  });

  it("ABCA landing-page leads are the early-retirement quiz", () => {
    expect(isAbcaLandingPageLead("early-retirement-quiz")).toBe(true);
    expect(isAbcaLandingPageLead("Facebook instant form")).toBe(false);
    expect(isAbcaLandingPageLead(null)).toBe(false);
  });

  it("alternates Ryan and Kyle one for one", () => {
    expect([1, 2, 3, 4].map(isGuestTurn)).toEqual([true, false, true, false]);
  });

  it("respects licensed states, with none on file meaning everywhere", () => {
    expect(guestLicensedFor([], "TX")).toBe(true);
    expect(guestLicensedFor(["TX"], "TX")).toBe(true);
    expect(guestLicensedFor(["TX"], "CA")).toBe(false);
  });
});
