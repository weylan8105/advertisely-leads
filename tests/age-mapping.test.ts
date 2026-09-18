import { describe, it, expect } from "vitest";
import { ageFromAnswer, mapCsvToLeads } from "@/lib/leadImport";
import { mapLeadFields } from "@/lib/meta";

// Pure unit tests — no DB, no network. Cover the age-range → age mapping that
// was leaving Meta/CSV leads with a null age.

describe("ageFromAnswer", () => {
  it("parses age ranges to their lower bound (hyphen + en-dash)", () => {
    expect(ageFromAnswer("18-29")).toBe(18);
    expect(ageFromAnswer("30–39")).toBe(30); // en-dash
    expect(ageFromAnswer("40–49")).toBe(40);
    expect(ageFromAnswer("50+")).toBe(50);
  });
  it("passes through a plain number", () => {
    expect(ageFromAnswer("44")).toBe(44);
  });
  it("returns null for empty/garbage/out-of-range", () => {
    expect(ageFromAnswer("")).toBeNull();
    expect(ageFromAnswer(null)).toBeNull();
    expect(ageFromAnswer(undefined)).toBeNull();
    expect(ageFromAnswer("abc")).toBeNull();
    expect(ageFromAnswer("5")).toBeNull();   // below 13
    expect(ageFromAnswer("200")).toBeNull(); // above 120
  });
});

describe("mapLeadFields age handling", () => {
  const baseFlat = { full_name: "Jane Doe", phone_number: "5551234567", state: "TX" };

  it("maps an explicitly-mapped age question (as a range) to the lower bound", () => {
    const { standardized } = mapLeadFields(
      { ...baseFlat, your_age: "40–49" },
      { your_age: "age" },
    );
    expect(standardized.age).toBe(40);
  });

  it("FALLBACK: derives age from an age-like field even when the form didn't map it", () => {
    const { standardized } = mapLeadFields(
      { ...baseFlat, age_range: "50+" }, // not in fieldMapping
      {},
    );
    expect(standardized.age).toBe(50);
  });

  it("leaves age undefined when there is no age field at all", () => {
    const { standardized } = mapLeadFields(baseFlat, {});
    expect(standardized.age).toBeUndefined();
  });
});

describe("mapCsvToLeads age handling", () => {
  it("maps the 'Age Range' column to age", () => {
    const rows = [
      ["Name", "Email", "Phone", "State", "Age Range"],
      ["Jane Doe", "jane@example.test", "5551234567", "Texas", "40–49"],
    ];
    const { leads } = mapCsvToLeads(rows);
    expect(leads[0].age).toBe(40);
    expect((leads[0].rawFormData as any).ageRange).toBe("40–49"); // range still preserved
  });
});
