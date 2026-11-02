import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: null, isDatabaseConfigured: false }));

describe("stageLevel", () => {
  it("classifies default stage ids", async () => {
    const { stageLevel } = await import("@/lib/activityStats");
    expect(stageLevel("new-lead", "New Lead")).toBe(0);
    expect(stageLevel("aged-lead", "Dialed")).toBe(1);
    expect(stageLevel("dnc", "DNC / Not Interested / Unqualified")).toBe(1);
    expect(stageLevel("follow-up", "Contacted")).toBe(2);
    expect(stageLevel("call-back", "Call Back")).toBe(3);
    expect(stageLevel("presentation-ran", "Presentation Ran / Follow up")).toBe(4);
    expect(stageLevel("underwriting", "Underwriting")).toBe(4);
  });

  it("classifies agents' custom stage labels", async () => {
    const { stageLevel } = await import("@/lib/activityStats");
    const cases: [string, number][] = [
      ["New Lead (Form Submitted)", 0],
      ["Aged Lead (3 Days +)", 0],
      ["2nd Aged Batch", 0],
      ["Dialed/Txted", 1],
      ["Disconnected Numbers", 1],
      ["Not Interested", 1],
      ["DNC / Not Interested", 1],
      ["Follow up", 2],
      ["Contacted", 2],
      ["Appointment Booked", 3],
      ["No Show'd", 3],
      ["Broke Follow up Later", 4],
      ["Banged on SSN/Banking", 4],
      ["Issued Not Paid", 4],
    ];
    for (const [label, level] of cases) expect([label, stageLevel("custom-x", label)]).toEqual([label, level]);
  });
});
