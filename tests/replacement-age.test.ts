import { describe, it, expect } from "vitest";
import { isOverAgeRequest, replacementAgeOk, MAX_AGE_FOR_AGE_REPLACEMENT } from "@/lib/replacementReasons";

describe("replacements asked for because of age", () => {
  it("recognises the stored reason, with or without extra detail", () => {
    expect(isOverAgeRequest("Over the age limit")).toBe(true);
    expect(isOverAgeRequest("Over the age limit — age 71")).toBe(true);
    expect(isOverAgeRequest("Disconnected number — out of service")).toBe(false);
    expect(isOverAgeRequest(null)).toBe(false);
  });

  it("only takes a lead aged 62 or under, or one with no exact age", () => {
    const r = "Over the age limit";
    expect(MAX_AGE_FOR_AGE_REPLACEMENT).toBe(62);
    expect(replacementAgeOk(r, 62)).toBe(true);
    expect(replacementAgeOk(r, 45)).toBe(true);
    expect(replacementAgeOk(r, null)).toBe(true);
    expect(replacementAgeOk(r, 63)).toBe(false);
    expect(replacementAgeOk(r, 73)).toBe(false);
  });

  it("leaves other replacement reasons alone", () => {
    expect(replacementAgeOk("Disconnected number", 73)).toBe(true);
    expect(replacementAgeOk("Duplicate lead", null)).toBe(true);
  });
});
