import { describe, it, expect } from "vitest";
import {
  addDays, costPer, dayStart, dealsByAgent, emptyCounts, eventRows, isApplicationMove, perfEvents, rangeDays, summarize, tally,
  campaignKeyOf, type PerfDial, type PerfLead, type PerfMove,
} from "../lib/adPerformance";

const lead = (over: Partial<PerfLead> = {}): PerfLead => ({
  id: "L1", source: "facebook", campaignName: null, utmCampaign: null, rawCampaign: null, assignedUserId: "luke",
  receivedAt: new Date("2026-11-01T15:00:00Z"), pipelineStage: "new-lead", soldAt: null, soldPremiumCents: null,
  ...over,
});
const move = (label: string, at: string, leadId = "L1"): PerfMove => ({
  leadId, body: `Moved to "${label}" in the pipeline.`, metadata: {}, createdAt: new Date(at),
});
const WINDOW: [Date, Date] = [new Date("2026-11-01T00:00:00Z"), new Date("2026-11-08T00:00:00Z")];
const total = (leads: PerfLead[], moves: PerfMove[], since = WINDOW[0], until = WINDOW[1], dials: PerfDial[] = []) =>
  tally(perfEvents(leads, moves, dials), since, until, () => "all").get("all") ?? emptyCounts();
const dial = (at: string, leadId = "L1"): PerfDial => ({ leadId, createdAt: new Date(at) });

describe("applications", () => {
  it("counts each of the four stages as an application", () => {
    for (const label of ["Underwriting", "Approved", "Issued Not Paid", "Issued PAID 💰"]) {
      expect(total([lead()], [move(label, "2026-11-02T15:00:00Z")]).applications).toBe(1);
    }
  });

  it("counts a lead once however many stages it passes through", () => {
    const moves = [
      move("Underwriting", "2026-11-02T15:00:00Z"),
      move("Approved", "2026-11-03T15:00:00Z"),
      move("Issued PAID 💰", "2026-11-04T15:00:00Z"),
    ];
    expect(total([lead()], moves).applications).toBe(1);
  });

  it("keeps the application when the lead is later declined", () => {
    const moves = [move("Underwriting", "2026-11-02T15:00:00Z"), move("Declined", "2026-11-03T15:00:00Z")];
    expect(total([lead({ pipelineStage: "declined" })], moves).applications).toBe(1);
  });

  it("dates the application to the first time it reached a stage", () => {
    const moves = [move("Underwriting", "2026-10-20T15:00:00Z"), move("Approved", "2026-11-03T15:00:00Z")];
    expect(total([lead()], moves).applications).toBe(0);
  });

  it("doesn't count earlier stages", () => {
    expect(total([lead()], [move("Presentation Ran / Follow up", "2026-11-02T15:00:00Z")]).applications).toBe(0);
  });

  it("reads the stage id on newer moves and partner conversions", () => {
    expect(isApplicationMove("Moved to \"x\" in the pipeline.", { stage: "approved" })).toBe(true);
    expect(isApplicationMove("Moved to \"Underwriting\" in the pipeline.", { stage: "call-back" })).toBe(false);
    expect(isApplicationMove("Conversion reported via API (sale) — AP $1,200.", null)).toBe(true);
  });
});

describe("funnel counts", () => {
  it("counts new leads by when they came in", () => {
    expect(total([lead()], []).leads).toBe(1);
    expect(total([lead({ receivedAt: new Date("2026-10-01T15:00:00Z") })], []).leads).toBe(0);
  });

  it("counts a lead moved with no logged dial as one dial, and contacted once per lead", () => {
    const moves = [
      move("Dialed", "2026-11-02T15:00:00Z"),
      move("Contacted", "2026-11-02T16:00:00Z"),
      move("Contacted", "2026-11-03T16:00:00Z"),
    ];
    const c = total([lead()], moves);
    expect(c.dials).toBe(1);
    expect(c.contacted).toBe(1);
  });

  it("counts a dialed lead that was never reached as dialed only", () => {
    const c = total([lead()], [move("Dialed", "2026-11-02T15:00:00Z")]);
    expect(c.dials).toBe(1);
    expect(c.contacted).toBe(0);
  });

  it("counts Issued PAID by the sold date, with its premium", () => {
    const sold = lead({ pipelineStage: "issued-paid", soldAt: new Date("2026-11-04T15:00:00Z"), soldPremiumCents: 240000 });
    const c = total([sold], []);
    expect(c.issuedPaid).toBe(1);
    expect(c.premiumCents).toBe(240000);
  });

  it("drops a sale that was moved back out of Issued PAID", () => {
    expect(total([lead({ pipelineStage: "approved", soldAt: new Date("2026-11-04T15:00:00Z") })], []).issuedPaid).toBe(0);
  });

  it("ignores activity on leads that aren't counted, like a client's", () => {
    expect(total([lead()], [move("Underwriting", "2026-11-02T15:00:00Z", "CLIENT")]).applications).toBe(0);
  });
});

describe("costs", () => {
  const campaign = (spendCents: number, impressions = 0, clicks = 0) => ({
    campaignId: "1", name: "c", funnel: "ew" as const, status: "ACTIVE", dailyBudgetCents: 30000,
    spendCents, impressions, clicks, linkClicks: 0, metaLeads: 0,
  });

  it("works out cost per lead, CPA and CAC from spend", () => {
    const s = summarize({ ...emptyCounts(), leads: 100, applications: 5, issuedPaid: 2 }, [campaign(100000)]);
    expect(s.cplCents).toBe(1000);
    expect(s.cpaCents).toBe(20000);
    expect(s.cacCents).toBe(50000);
  });

  it("shows no cost when there's nothing to divide by", () => {
    const s = summarize(emptyCounts(), [campaign(5000)]);
    expect(s.cpaCents).toBeNull();
    expect(s.cacCents).toBeNull();
    expect(costPer(5000, 0)).toBeNull();
  });

  it("leaves costs blank when Meta wouldn't return the spend", () => {
    const s = summarize({ ...emptyCounts(), leads: 100, applications: 5, issuedPaid: 2 }, [], false);
    expect(s.spendKnown).toBe(false);
    expect(s.cplCents).toBeNull();
    expect(s.cpaCents).toBeNull();
    expect(s.cacCents).toBeNull();
  });

  it("adds up spend and delivery across campaigns", () => {
    const s = summarize(emptyCounts(), [campaign(1000, 1000, 30), campaign(3000, 1000, 10)]);
    expect(s.spendCents).toBe(4000);
    expect(s.cpmCents).toBe(2000);
    expect(s.ctrPct).toBe(2);
    expect(s.activeBudgetCents).toBe(60000);
  });
});

describe("campaign matching", () => {
  const ids = new Map([["Blue Collar ER - Updated Messaging", "111"]]);

  it("uses the Meta id when the lead has one", () => {
    expect(campaignKeyOf(lead({ utmCampaign: "120250442615980207" }), ids)).toBe("120250442615980207");
    expect(campaignKeyOf(lead({ rawCampaign: "222" }), ids)).toBe("222");
  });

  it("falls back to the campaign name", () => {
    expect(campaignKeyOf(lead({ campaignName: "Blue Collar ER - Updated Messaging" }), ids)).toBe("111");
    expect(campaignKeyOf(lead({ utmCampaign: "Blue Collar ER - Updated Messaging" }), ids)).toBe("111");
  });

  it("leaves a lead with no campaign unmatched", () => {
    expect(campaignKeyOf(lead(), ids)).toBeNull();
  });
});

describe("dials", () => {
  const AFTER = [new Date("2026-11-07T00:00:00Z"), new Date("2026-11-20T00:00:00Z")] as const;
  const counts = (leads: PerfLead[], moves: PerfMove[], dials: PerfDial[]) => total(leads, moves, AFTER[0], AFTER[1], dials);

  it("counts every dial, and the lead once", () => {
    const c = counts([lead()], [], [dial("2026-11-08T15:00:00Z"), dial("2026-11-08T19:00:00Z"), dial("2026-11-09T15:00:00Z")]);
    expect(c.dials).toBe(3);
    expect(c.leadsDialed).toBe(1);
  });

  it("doesn't add a dial for the stage move when dials were logged", () => {
    const c = counts([lead()], [move("Dialed", "2026-11-08T15:01:00Z")], [dial("2026-11-08T15:00:00Z"), dial("2026-11-08T19:00:00Z")]);
    expect(c.dials).toBe(2);
    expect(c.leadsDialed).toBe(1);
  });

  it("only counts dials in the window", () => {
    expect(counts([lead()], [], [dial("2026-11-06T23:00:00Z"), dial("2026-11-08T15:00:00Z")]).dials).toBe(1);
  });

  it("averages the dials leads took before they were contacted", () => {
    const leads = [lead({ id: "A" }), lead({ id: "B" })];
    const moves = [move("Contacted", "2026-11-09T15:00:00Z", "A"), move("Contacted", "2026-11-09T15:00:00Z", "B")];
    const dials = [
      dial("2026-11-07T15:00:00Z", "A"), dial("2026-11-08T15:00:00Z", "A"), dial("2026-11-09T14:59:00Z", "A"),
      dial("2026-11-09T14:59:00Z", "B"),
    ];
    const c = counts(leads, moves, dials);
    expect([c.reached, c.dialsToReach]).toEqual([2, 4]);
    expect(summarize(c, []).dialsPerContact).toBe(2);
  });

  it("ignores dials after the first contact", () => {
    const moves = [move("Contacted", "2026-11-09T15:00:00Z"), move("Call Back", "2026-11-12T15:00:00Z")];
    expect(counts([lead()], moves, [dial("2026-11-09T14:00:00Z"), dial("2026-11-11T15:00:00Z")]).dialsToReach).toBe(1);
  });

  it("counts at least one dial for a lead contacted with none logged", () => {
    expect(counts([lead()], [move("Contacted", "2026-11-09T15:00:00Z")], []).dialsToReach).toBe(1);
  });

  it("doesn't measure a lead that was being worked before dials were logged", () => {
    const moves = [move("Dialed", "2026-11-03T15:00:00Z"), move("Contacted", "2026-11-09T15:00:00Z")];
    const c = counts([lead()], moves, [dial("2026-11-09T14:00:00Z")]);
    expect(c.contacted).toBe(1);
    expect(c.reached).toBe(0);
    expect(summarize(c, []).dialsPerContact).toBeNull();
  });
});

describe("deals by agent", () => {
  const deals = (leads: PerfLead[], moves: PerfMove[] = []) => dealsByAgent(leads, perfEvents(leads, moves), (id) => id.toUpperCase());

  it("counts each deal in the stage it's in now, however long ago it got there", () => {
    const leads = [
      lead({ id: "A", pipelineStage: "underwriting" }),
      lead({ id: "B", pipelineStage: "approved" }),
      lead({ id: "C", pipelineStage: "issued-not-paid" }),
      lead({ id: "D", pipelineStage: "issued-paid", soldPremiumCents: 240_000 }),
      lead({ id: "E", pipelineStage: "issued-paid", soldPremiumCents: 60_000 }),
    ];
    expect(deals(leads)).toEqual([{
      agent: "LUKE", underwriting: 1, approved: 1, issuedNotPaid: 1, issuedPaid: 2, leftStages: 0, applications: 5, premiumCents: 300_000,
    }]);
  });

  it("keeps a declined deal as an application, apart from the stage columns", () => {
    const [row] = deals([lead({ pipelineStage: "declined" })], [move("Underwriting", "2026-10-02T15:00:00Z")]);
    expect(row).toMatchObject({ underwriting: 0, leftStages: 1, applications: 1 });
  });

  it("leaves out leads that never reached an application", () => {
    expect(deals([lead({ pipelineStage: "presentation-ran" })], [move("Call Back", "2026-10-02T15:00:00Z")])).toEqual([]);
  });

  it("lists agents with the most deals first and groups leads with no owner", () => {
    const rows = deals([
      lead({ id: "A", pipelineStage: "approved", assignedUserId: "ryan" }),
      lead({ id: "B", pipelineStage: "approved" }),
      lead({ id: "C", pipelineStage: "underwriting" }),
      lead({ id: "D", pipelineStage: "underwriting", assignedUserId: null }),
    ]);
    expect(rows.map((r) => [r.agent, r.applications])).toEqual([["LUKE", 2], ["RYAN", 1], ["Unassigned", 1]]);
  });
});

describe("events sent to Meta", () => {
  const row = (rows: ReturnType<typeof eventRows>, stage: string) => rows.find((r) => r.stage === stage)!;

  it("groups a closed deal's old and new names on one row", () => {
    const rows = eventRows(
      ["ok Approved rcvd:1 lead:a", "ok CompleteRegistration rcvd:1 lead:b", "ok AddPaymentInfo rcvd:1 lead:c", "ok Purchase rcvd:1 lead:d"],
      null,
    );
    expect(row(rows, "Closed deal (Underwriting on)").sent).toBe(4);
    expect(row(rows, "Closed deal (Underwriting on)").event).toBe("Purchase");
  });

  it("counts the older log format as a lead event and skips aren't failures", () => {
    const rows = eventRows(["ok lead:abc", "not an ad click (no fbclid/fbc/fbp) Lead lead:x"], null);
    expect(row(rows, "New quiz lead").sent).toBe(1);
    expect(row(rows, "New quiz lead").failed).toBe(0);
  });

  it("counts refused events", () => {
    expect(row(eventRows(["error Purchase lead:a"], null), "Closed deal (Underwriting on)").failed).toBe(1);
  });

  it("shows pixel counts, except quiz leads, which the browser also sends", () => {
    const rows = eventRows([], { Purchase: 3, Lead: 40, Approved: 1, CompleteRegistration: 2 });
    expect(row(rows, "Closed deal (Underwriting on)").shown).toBe(6);
    expect(row(rows, "New quiz lead").shown).toBeNull();
  });

  it("leaves the pixel column blank when it can't be read", () => {
    expect(row(eventRows([], null), "Closed deal (Underwriting on)").shown).toBeNull();
  });
});

describe("date windows", () => {
  it("builds each range from today", () => {
    expect(rangeDays("today", "2026-11-06")).toEqual({ since: "2026-11-06", until: "2026-11-06" });
    expect(rangeDays("yesterday", "2026-11-06")).toEqual({ since: "2026-11-05", until: "2026-11-05" });
    expect(rangeDays("7d", "2026-11-06")).toEqual({ since: "2026-10-31", until: "2026-11-06" });
    expect(rangeDays("shared", "2026-11-06")).toEqual({ since: "2026-09-14", until: "2026-11-06" });
  });

  it("finds midnight in a timezone, on either side of daylight saving", () => {
    expect(dayStart("2026-11-06", "America/Chicago").toISOString()).toBe("2026-11-06T06:00:00.000Z");
    expect(dayStart("2026-10-20", "America/Chicago").toISOString()).toBe("2026-10-20T05:00:00.000Z");
  });

  it("rolls dates across a month", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});
