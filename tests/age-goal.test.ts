import { describe, it, expect } from "vitest";
import { ageFromDob, isOverAgeKnockout } from "@/lib/ageGoal";

describe("ageFromDob", () => {
  const today = new Date(Date.UTC(2026, 10, 23)); // Nov 23 2026
  it("counts whole years, before and after the birthday", () => {
    expect(ageFromDob("1970-11-23", today)).toBe(56);
    expect(ageFromDob("1970-11-24", today)).toBe(55);
    expect(ageFromDob("11/24/1970", today)).toBe(55);
    expect(ageFromDob("1990-05-12T00:00:00.000Z", today)).toBe(36);
  });
  it("returns null for junk", () => {
    expect(ageFromDob("", today)).toBeNull();
    expect(ageFromDob("soon", today)).toBeNull();
    expect(ageFromDob("1990-13-01", today)).toBeNull();
  });
});

describe("isOverAgeKnockout", () => {
  it("knocks out anyone over 55 by typed age or date of birth", () => {
    expect(isOverAgeKnockout({ age: "56" })).toBe(true);
    expect(isOverAgeKnockout({ age: "55" })).toBe(false);
    expect(isOverAgeKnockout({ date_of_birth: "1950-01-01" })).toBe(true);
    expect(isOverAgeKnockout({ date_of_birth: "1995-01-01" })).toBe(false);
    expect(isOverAgeKnockout({})).toBe(false);
  });
});
