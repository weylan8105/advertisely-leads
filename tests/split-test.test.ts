import { describe, it, expect } from "vitest";
import { SPLIT_TESTS, scoreSplitTest, leadLevel, reachedApp, type SplitLead, type SplitMove } from "@/lib/splitTest";

const ew = SPLIT_TESTS.find((t) => t.key === "ew")!;
const OPEN = ew.arms[0].campaignIds[0];
const FILTERED = ew.arms[1].campaignIds[0];
const q = "What is your gross monthly income?";

const lead = (id: string, campaignId: string, extra: Partial<SplitLead> = {}): SplitLead => ({
  id,
  campaignId,
  rawFormData: { [q]: "$5,000 to $7,500", "What's your age?": "40" },
  pipelineStage: "new-lead",
  soldAt: null,
  soldPremiumCents: null,
  trashed: false,
  ...extra,
});
const move = (leadId: string, label: string, stage?: string): SplitMove => ({
  leadId,
  body: `Moved to "${label}" in the pipeline.`,
  metadata: stage ? { stage, label } : null,
});

describe("split test scorecard", () => {
  it("counts each lead once, in the arm its campaign belongs to", () => {
    const leads = [lead("a", OPEN), lead("b", OPEN), lead("c", FILTERED), lead("x", "999999999999")];
    const [open, filtered] = scoreSplitTest(ew, leads, [], new Map([[OPEN, 10_000], [FILTERED, 5_000]]));
    expect(open).toMatchObject({ key: "open", leads: 2, spendCents: 10_000 });
    expect(filtered).toMatchObject({ key: "filtered", leads: 1, spendCents: 5_000 });
  });

  it("scores qualified only on leads that answered age and income", () => {
    const leads = [
      lead("a", OPEN),
      lead("b", OPEN, { rawFormData: { [q]: "Under $3,000", "What's your age?": "40" } }),
      lead("c", OPEN, { rawFormData: { "What's your age?": "40" } }), // income not asked: unscored
    ];
    const [open] = scoreSplitTest(ew, leads, [], new Map());
    expect(open).toMatchObject({ scored: 2, qualified: 1 });
  });

  it("uses the furthest stage a lead ever reached, not just where it sits now", () => {
    const l = lead("a", OPEN, { pipelineStage: "dnc" });
    const moves = [move("a", "Contacted", "follow-up"), move("a", "Call Back", "call-back"), move("a", "DNC / Not Interested / Unqualified", "dnc")];
    expect(leadLevel(l, moves)).toBe(3);
    const [open] = scoreSplitTest(ew, [l], moves, new Map());
    expect(open).toMatchObject({ dialed: 1, contacted: 1, appointments: 1, presentations: 0, apps: 0 });
  });

  it("keeps an application counted after a decline, and counts sales and premium", () => {
    const declined = lead("a", FILTERED, { pipelineStage: "dnc" });
    const sold = lead("b", FILTERED, { pipelineStage: "issued-paid", soldAt: new Date(), soldPremiumCents: 240_000 });
    const moves = [move("a", "Underwriting")];
    expect(reachedApp(declined, moves)).toBe(true);
    const [, filtered] = scoreSplitTest(ew, [declined, sold], moves, new Map());
    expect(filtered).toMatchObject({ apps: 2, sold: 1, premiumCents: 240_000 });
  });

  it("counts trashed leads as leads, and separately as trashed", () => {
    const [open] = scoreSplitTest(ew, [lead("a", OPEN, { trashed: true }), lead("b", OPEN)], [], new Map());
    expect(open).toMatchObject({ leads: 2, trashed: 1 });
  });
});
