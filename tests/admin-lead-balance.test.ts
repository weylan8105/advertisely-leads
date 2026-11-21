import { describe, it, expect } from "vitest";
import { windowCplCents, leadCplCents, coversLead, addDaysYmd, CPL_WINDOW_DAYS, type DailyCosts } from "@/lib/leadCostLedger";

const row = (spend: number, leads: number) => ({ spend: spend.toFixed(2), actions: [{ action_type: "lead", value: String(leads) }] });

function costs(days: Record<string, [number, number, number?]>): DailyCosts {
  const ins = new Map<string, ReturnType<typeof row>>();
  const arr = new Map<string, number>();
  for (const [d, [spend, leads, arrived]] of Object.entries(days)) {
    ins.set(d, row(spend, leads));
    if (arrived != null) arr.set(d, arrived);
  }
  return { insights: new Map([["abca", ins]]), arrived: new Map([["abca", arr]]) } as DailyCosts;
}

describe("admin lead balance pricing", () => {
  it("averages spend ÷ leads over the 14 days up to the delivery day", () => {
    expect(CPL_WINDOW_DAYS).toBe(14);
    const c = costs({ "2026-11-05": [100, 10], "2026-11-18": [300, 10], "2026-11-19": [999, 1] });
    // Nov 18 window = Nov 5..18: (100 + 300) / 20 = $20.00; Nov 19 is after the day, ignored.
    expect(leadCplCents(c, ["abca"], "2026-11-18")).toBe(2000);
    // Nov 5 is the 14th day back from Nov 18, and drops out of the Nov 19 window.
    expect(addDaysYmd("2026-11-18", -(CPL_WINDOW_DAYS - 1))).toBe("2026-11-05");
    expect(leadCplCents(c, ["abca"], "2026-11-19")).toBe(Math.round(((300 + 999) * 100) / 11));
  });

  it("divides by the leads that arrived when Meta counted more", () => {
    const c = costs({ "2026-11-18": [400, 20, 16] });
    expect(leadCplCents(c, ["abca"], "2026-11-18")).toBe(2500);
  });

  it("returns null with no spend or leads (caller uses the fallback)", () => {
    expect(leadCplCents(costs({}), ["abca"], "2026-11-18")).toBeNull();
    expect(windowCplCents(costs({ "2026-11-01": [100, 10] }), ["abca"], "2026-11-18", CPL_WINDOW_DAYS)).toBeNull();
  });
});

describe("advance or prepay", () => {
  it("advance always takes the lead, whatever the balance", () => {
    expect(coversLead("advance", -500_000, 4000)).toBe(true);
    expect(coversLead("advance", 0, 4000)).toBe(true);
  });

  it("prepay takes a lead only while the balance covers its cost", () => {
    expect(coversLead("prepay", 4000, 4000)).toBe(true);
    expect(coversLead("prepay", 3999, 4000)).toBe(false);
    expect(coversLead("prepay", 0, 4000)).toBe(false);
    // Still owing from before: nothing until that is paid and one lead is covered.
    expect(coversLead("prepay", -100, 2000)).toBe(false);
  });
});
