import { describe, it, expect } from "vitest";
import { leadMatchesSearch, matchesWords, searchWords } from "@/lib/leadSearch";
import type { Lead } from "@/types";

const lead = { id: "l1", name: "Dana Reed", email: "dana@example.test", phone: "(214) 555-0147", state: "TX", tags: ["hot"] } as unknown as Lead;
const finds = (q: string) => leadMatchesSearch(lead, searchWords(q));

describe("lead search", () => {
  it("finds a lead by name, email, state and tag", () => {
    expect(finds("dana reed")).toBe(true);
    expect(finds("dana@example")).toBe(true);
    expect(finds("texas")).toBe(true);
    expect(finds("hot")).toBe(true);
  });

  it("finds a phone number however it's typed", () => {
    for (const q of ["2145550147", "214-555", "(214) 555", "555.0147"]) expect(finds(q)).toBe(true);
  });

  it("needs every word to match", () => {
    expect(finds("dana smith")).toBe(false);
  });

  it("ignores digit fragments too short to mean a phone number", () => {
    expect(matchesWords(searchWords("21"), "Dana", "2145550147")).toBe(false);
  });
});
