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

describe("addFunnelStats", () => {
  const run = async (moves: any[], dials: any[], allowed: Set<string> | null = null) => {
    const { addFunnelStats, emptyStats } = await import("@/lib/activityStats");
    const out = new Map<string, ReturnType<typeof emptyStats>>();
    addFunnelStats(moves, dials, (id) => out.get(id) ?? out.set(id, emptyStats()).get(id)!, allowed);
    return out;
  };
  const moved = (label: string, leadId = "L1", actorId = "sam") => ({
    leadId, body: `Moved to "${label}" in the pipeline.`, metadata: { actorId }, ownerId: "owner",
  });

  it("counts every logged dial", async () => {
    const dials = [{ leadId: "L1", actorId: "sam" }, { leadId: "L1", actorId: "sam" }, { leadId: "L2", actorId: "sam" }];
    expect((await run([], dials)).get("sam")?.dials).toBe(3);
  });

  it("counts a lead moved with no logged dial as one dial", async () => {
    const s = (await run([moved("Dialed"), moved("Contacted")], [])).get("sam");
    expect(s).toMatchObject({ dials: 1, contacts: 1 });
  });

  it("doesn't add a dial for the move when that agent logged dials on the lead", async () => {
    const dials = [{ leadId: "L1", actorId: "sam" }, { leadId: "L1", actorId: "sam" }];
    expect((await run([moved("Contacted")], dials)).get("sam")).toMatchObject({ dials: 2, contacts: 1 });
  });

  it("credits each agent their own dials on a shared lead", async () => {
    const out = await run([moved("Contacted", "L1", "pat")], [{ leadId: "L1", actorId: "sam" }]);
    expect(out.get("sam")?.dials).toBe(1);
    expect(out.get("pat")).toMatchObject({ dials: 1, contacts: 1 });
  });

  it("leaves out agents outside the list", async () => {
    const out = await run([moved("Contacted", "L1", "pat")], [{ leadId: "L1", actorId: "pat" }], new Set(["sam"]));
    expect(out.size).toBe(0);
  });
});
