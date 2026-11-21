import { describe, it, expect } from "vitest";
import {
  isIncomeQualified,
  isQualifiedLead,
  ageAnswer,
  monthlyIncomeAnswer,
  QUALIFIED_LEAD_EVENT,
  CONTACTED_EVENT,
  isPickupStage,
} from "@/lib/metaCapi";

const q = "What is your gross monthly income?";
const a = "What's your age?";

describe("income part: gross monthly income $3,000+", () => {
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
});

describe("Qualified Lead = income $3,000+ AND age 55 or younger", () => {
  it("needs both", () => {
    expect(isQualifiedLead({ [q]: "$3,000 to $5,000", [a]: "55" })).toBe(true);
    expect(isQualifiedLead({ [q]: "$10,000+", [a]: "38" })).toBe(true);
    expect(isQualifiedLead({ [q]: "$3,000 to $5,000", [a]: "56" })).toBe(false);
    expect(isQualifiedLead({ [q]: "Under $3,000", [a]: "40" })).toBe(false);
  });
  it("fails fast on a known miss, never guesses a missing answer", () => {
    expect(isQualifiedLead({ [a]: "62" })).toBe(false);
    expect(isQualifiedLead({ [q]: "$5,000 to $7,500" })).toBeNull();
    expect(isQualifiedLead({ [a]: "40" })).toBeNull();
  });
  it("reads the age question, not an age-range one", () => {
    expect(ageAnswer({ [a]: "54" })).toBe(54);
    expect(ageAnswer({ whats_your_age: "47 years" })).toBe(47);
    expect(ageAnswer({ "What's your age range?": "35-44" })).toBeNull();
  });
  it("standard event names no other path sends", () => {
    expect(QUALIFIED_LEAD_EVENT).toBe("Subscribe");
    expect(CONTACTED_EVENT).toBe("StartTrial");
  });
  it("pickup stages: Contacted, Call Back, Presentation Ran and closing stages", () => {
    for (const s of ["follow-up", "call-back", "presentation-ran", "underwriting", "issued-paid"]) expect(isPickupStage(s)).toBe(true);
    for (const s of ["new-lead", "aged-lead", "dnc", "chargeback"]) expect(isPickupStage(s)).toBe(false);
  });
});

describe("ABCA main page (asks age, not income): qualified on age 20 to 55", () => {
  const page = (age: string, extra: Record<string, string> = {}) => ({ lead_source: "early-retirement-quiz", quiz_age: age, age, ...extra });
  it("counts 20 through 55, and nothing outside it", () => {
    expect(isQualifiedLead(page("20"))).toBe(true);
    expect(isQualifiedLead(page("38"))).toBe(true);
    expect(isQualifiedLead(page("55"))).toBe(true);
    expect(isQualifiedLead(page("19"))).toBe(false);
    expect(isQualifiedLead(page("56"))).toBe(false);
  });
  it("never guesses a missing age", () => {
    expect(isQualifiedLead({ lead_source: "early-retirement-quiz" })).toBeNull();
  });
  it("page B (/qualify) keeps the full income + age rule", () => {
    const b = page("40", { quiz_variant: "instant-form-questions" });
    expect(isQualifiedLead(b)).toBeNull(); // no income answer: never guessed
    expect(isQualifiedLead({ ...b, [q]: "Under $3,000" })).toBe(false);
    expect(isQualifiedLead({ ...b, [q]: "$3,000 to $5,000" })).toBe(true);
  });
  it("other sources keep needing income", () => {
    expect(isQualifiedLead({ quiz_age: "40" })).toBeNull();
  });
  it("from Nov 21 the page asks income too: $3,000+ and age 20 to 55", () => {
    expect(isQualifiedLead(page("40", { [q]: "Under $3,000" }))).toBe(false);
    expect(isQualifiedLead(page("40", { [q]: "$3,000 to $5,000" }))).toBe(true);
    expect(isQualifiedLead(page("19", { [q]: "$10,000+" }))).toBe(false);
    expect(isQualifiedLead(page("56", { [q]: "$10,000+" }))).toBe(false);
  });
  it("the work question stands in for income: steady work, overtime or own business", () => {
    const w = "Which best describes your work right now?";
    expect(isQualifiedLead(page("40", { [w]: "Full-time with a steady paycheck" }))).toBe(true);
    expect(isQualifiedLead(page("40", { [w]: "Hourly, with regular overtime" }))).toBe(true);
    expect(isQualifiedLead(page("40", { [w]: "I run my own business or crew" }))).toBe(true);
    expect(isQualifiedLead(page("40", { [w]: "Part-time or seasonal" }))).toBe(false);
    expect(isQualifiedLead(page("40", { [w]: "Between jobs right now" }))).toBe(false);
    expect(isQualifiedLead(page("19", { [w]: "I run my own business or crew" }))).toBe(false);
    expect(isQualifiedLead(page("60", { [w]: "Full-time with a steady paycheck" }))).toBe(false);
    // Only the ABCA main page uses it.
    expect(isQualifiedLead({ quiz_age: "40", [w]: "Full-time with a steady paycheck" })).toBeNull();
  });
});
