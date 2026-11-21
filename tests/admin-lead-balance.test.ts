import { describe, it, expect } from "vitest";
import { windowCplCents, addDaysYmd, type DailyCosts } from "@/lib/leadCostLedger";

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
    const c = costs({ "2026-11-05": [100, 10], "2026-11-18": [300, 10], "2026-11-19": [999, 1] });
    // Nov 18 window = Nov 5..18: (100 + 300) / 20 = $20.00; Nov 19 is after the day, ignored.
    expect(windowCplCents(c, ["abca"], "2026-11-18")).toBe(2000);
    // Nov 5 is the 14th day back from Nov 18, and drops out of the Nov 19 window.
    expect(addDaysYmd("2026-11-18", -13)).toBe("2026-11-05");
    expect(windowCplCents(c, ["abca"], "2026-11-19")).toBe(Math.round(((300 + 999) * 100) / 11));
  });

  it("divides by the leads that arrived when Meta counted more", () => {
    const c = costs({ "2026-11-18": [400, 20, 16] });
    expect(windowCplCents(c, ["abca"], "2026-11-18")).toBe(2500);
  });

  it("returns null with no spend or leads (caller uses the fallback)", () => {
    expect(windowCplCents(costs({}), ["abca"], "2026-11-18")).toBeNull();
  });
});
