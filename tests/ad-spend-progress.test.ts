import { describe, it, expect } from "vitest";
import { adSpendProgress } from "@/lib/adSpendProgress";

describe("adSpendProgress", () => {
  it("is spent out of paid in", () => {
    expect(adSpendProgress({ availableCents: 400000, chargedCents: 100000, balanceCents: 300000, daysLeft: 20 })).toEqual({ pct: 25, out: false, low: false });
  });
  it("warns with 3 days or less left", () => {
    expect(adSpendProgress({ availableCents: 100000, chargedCents: 95000, balanceCents: 5000, daysLeft: 1 })).toMatchObject({ pct: 95, low: true, out: false });
  });
  it("is out and full when the budget is used up or overspent", () => {
    expect(adSpendProgress({ availableCents: 100000, chargedCents: 104000, balanceCents: -4000, daysLeft: 0 })).toEqual({ pct: 100, out: true, low: false });
    expect(adSpendProgress({ availableCents: 0, chargedCents: 0, balanceCents: 0, daysLeft: null })).toEqual({ pct: 100, out: true, low: false });
  });
});
