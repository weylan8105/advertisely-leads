import { describe, it, expect } from "vitest";
import { isIncomeQualified, monthlyIncomeAnswer, QUALIFIED_LEAD_EVENT } from "@/lib/metaCapi";

const q = "What is your gross monthly income?";

describe("qualified lead = gross monthly income $3,000+", () => {
  it("second option or better qualifies", () => {
    expect(isIncomeQualified({ [q]: "Under $3,000" })).toBe(false);
    expect(isIncomeQualified({ [q]: "$3,000 to $5,000" })).toBe(true);
    expect(isIncomeQualified({ [q]: "$5,000 to $7,500" })).toBe(true);
    expect(isIncomeQualified({ [q]: "$7,500 to $10,000" })).toBe(true);
    expect(isIncomeQualified({ [q]: "$10,000+" })).toBe(true);
  });
  it("finds snake_case keys and handles k notation", () => {
    expect(isIncomeQualified({ what_is_your_gross_monthly_income: "$3k-$5k" })).toBe(true);
    expect(monthlyIncomeAnswer({ "What is your gross monthly income? ": " $5,000 to $7,500 " })).toBe("$5,000 to $7,500");
  });
  it("never guesses when the question wasn't asked or was left blank", () => {
    expect(isIncomeQualified({ "What's your current household income?": "$100,000+" })).toBeNull();
    expect(isIncomeQualified({ [q]: "" })).toBeNull();
    expect(isIncomeQualified(null)).toBeNull();
  });
  it("goes to Meta as a standard event no other path sends", () => {
    expect(QUALIFIED_LEAD_EVENT).toBe("Subscribe");
  });
});
