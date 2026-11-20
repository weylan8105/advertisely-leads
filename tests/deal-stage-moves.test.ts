import { describe, expect, it } from "vitest";
import { bestLevels, type StageMoveRow } from "@/lib/activityStats";
import { perfEvents, tally, type PerfLead, type PerfMove } from "@/lib/adPerformance";

const move = (leadId: string, stage: string, afterDeal = false): StageMoveRow => ({
  leadId, body: "", metadata: { stage, actorId: "u1" }, ownerId: "u1", afterDeal,
});

describe("deal-stage moves aren't contacts", () => {
  it("bestLevels skips moves after the application", () => {
    const best = bestLevels([move("a", "approved", true), move("b", "underwriting"), move("c", "follow-up")], null);
    expect(best.has("u1\u0000a")).toBe(false); // Underwriting → Approved today: not a contact
    expect(best.get("u1\u0000b")).toBe(4); // one-call close: the submission still counts
    expect(best.get("u1\u0000c")).toBe(2);
  });

  it("Ad Performance doesn't count a deal moving along as contacted", () => {
    const lead: PerfLead = {
      id: "a", source: null, campaignName: null, utmCampaign: null, rawCampaign: null, assignedUserId: "u1",
      receivedAt: new Date("2026-10-01T12:00:00Z"), pipelineStage: "approved", soldAt: null, soldPremiumCents: null,
    };
    const moves: PerfMove[] = [
      { leadId: "a", body: "", metadata: { stage: "underwriting" }, createdAt: new Date("2026-10-05T12:00:00Z") },
      { leadId: "a", body: "", metadata: { stage: "approved" }, createdAt: new Date("2026-11-20T12:00:00Z") },
    ];
    const today = tally(perfEvents([lead], moves), new Date("2026-11-20T06:00:00Z"), new Date("2026-11-21T06:00:00Z"), () => "k").get("k");
    expect(today?.contacted ?? 0).toBe(0);
    expect(today?.dials ?? 0).toBe(0);
    const oct = tally(perfEvents([lead], moves), new Date("2026-10-05T00:00:00Z"), new Date("2026-10-06T00:00:00Z"), () => "k").get("k")!;
    expect(oct.contacted).toBe(1);
    expect(oct.applications).toBe(1);
  });
});
