import { describe, expect, it } from "vitest";
import { parseCustomDays, rangeDays } from "@/lib/adPerformance";
import { rangeWindow } from "@/lib/liveStats";

describe("parseCustomDays", () => {
  const today = "2026-11-20";
  it("accepts a real range", () => {
    expect(parseCustomDays("2026-11-01", "2026-11-10", today)).toEqual({ since: "2026-11-01", until: "2026-11-10" });
  });
  it("swaps a backwards range and stops at today", () => {
    expect(parseCustomDays("2026-11-10", "2026-11-01", today)).toEqual({ since: "2026-11-01", until: "2026-11-10" });
    expect(parseCustomDays("2026-11-15", "2026-12-31", today)).toEqual({ since: "2026-11-15", until: "2026-11-20" });
    expect(parseCustomDays("2026-12-01", "2026-12-05", today)).toEqual({ since: "2026-11-20", until: "2026-11-20" });
  });
  it("rejects junk", () => {
    expect(parseCustomDays("2026-02-30", "2026-03-01", today)).toBeNull();
    expect(parseCustomDays("nope", "2026-03-01", today)).toBeNull();
    expect(parseCustomDays(null, "2026-03-01", today)).toBeNull();
  });
  it("rangeDays uses the custom days, else the 30 days", () => {
    expect(rangeDays("custom", today, { since: "2026-11-01", until: "2026-11-02" })).toEqual({ since: "2026-11-01", until: "2026-11-02" });
    expect(rangeDays("custom", today)).toEqual({ since: "2026-10-22", until: "2026-11-20" });
  });
});

describe("rangeWindow custom", () => {
  it("covers both days in Central time", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    const w = rangeWindow("custom", now, { since: "2026-11-01", until: "2026-11-02" });
    expect(w.since?.toISOString()).toBe("2026-11-01T05:00:00.000Z"); // CDT
    expect(w.until?.toISOString()).toBe("2026-11-03T06:00:00.000Z"); // CST
  });
  it("is open-ended when it reaches today", () => {
    const now = new Date("2026-11-20T18:00:00Z");
    expect(rangeWindow("custom", now, { since: "2026-11-15", until: "2026-11-20" }).until).toBeNull();
  });
});
