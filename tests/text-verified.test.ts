import { describe, it, expect } from "vitest";
import { isTextVerified } from "@/lib/textVerified";
import { serializeLead } from "@/lib/serialize";

describe("text verified leads", () => {
  it("badges leads from the SMS-check ad, by ad id", () => {
    expect(isTextVerified({ creativeId: "120249710045080601" })).toBe(true);
    expect(isTextVerified({ creativeId: " 120249710045080601 " })).toBe(true);
    // Ad 4 runs on a similar form but wasn't named, so no badge.
    expect(isTextVerified({ creativeId: "120249714399680601" })).toBe(false);
    expect(isTextVerified({ creativeId: null })).toBe(false);
    expect(isTextVerified({})).toBe(false);
  });

  it("reaches the lead card through serializeLead", () => {
    const base = { id: "l1", name: "A", phone: "1", email: "", state: "TX", source: "facebook", rawFormData: {}, consentMethod: "TCPA_WEB_FORM", status: "NEW" };
    expect(serializeLead({ ...base, creativeId: "120249710045080601" }).textVerified).toBe(true);
    expect(serializeLead({ ...base, creativeId: "999" }).textVerified).toBeUndefined();
  });
});
