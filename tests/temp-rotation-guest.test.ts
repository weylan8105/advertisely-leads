import { describe, it, expect } from "vitest";
import {
  isEwTextVerifiedLead,
  isAbcaLandingPageLead,
  guestLicensedFor,
  guestTurnIndex,
  TEMP_ROTATION_GUEST,
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

  it("one guest alternates with Ryan one for one", () => {
    expect([1, 2, 3, 4].map((n) => guestTurnIndex(n, 1))).toEqual([0, -1, 0, -1]);
  });

  it("two guests and Ryan take even turns", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => guestTurnIndex(n, 2))).toEqual([0, 1, -1, 0, 1, -1]);
    expect(guestTurnIndex(1, 0)).toBe(-1);
  });

  it("Kyle is the only free guest; Angelo pays per lead as a client", () => {
    expect(TEMP_ROTATION_GUEST.guests.map((g) => g.name)).toEqual(["Kyle"]);
  });

  it("respects licensed states, with none on file meaning everywhere", () => {
    expect(guestLicensedFor([], "TX")).toBe(true);
    expect(guestLicensedFor(["TX"], "TX")).toBe(true);
    expect(guestLicensedFor(["TX"], "CA")).toBe(false);
  });
});

describe("billed guest (Kyle → David after 10 free leads)", async () => {
  const { guestIsBilled, TEMP_ROTATION_GUEST } = await import("@/lib/tempRotationGuest");
  it("stays free for the first 10, then bills", () => {
    const billTo = { email: "payer@example.com", freeLeads: 10, countFrom: "2026-11-14T00:00:00Z" };
    expect(guestIsBilled(billTo, 0)).toBe(false);
    expect(guestIsBilled(billTo, 9)).toBe(false);
    expect(guestIsBilled(billTo, 10)).toBe(true);
    expect(guestIsBilled(undefined, 50)).toBe(false);
  });
  it("Kyle is billed to David", () => {
    const kyle = TEMP_ROTATION_GUEST.guests.find((g) => g.email === "kylevitz@gmail.com") as any;
    expect(kyle.billTo).toMatchObject({ email: "dclayton1235@gmail.com", freeLeads: 10 });
  });
});
