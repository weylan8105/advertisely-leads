import { describe, it, expect } from "vitest";
import { buildLeadPace, paceStatus, type LeadPaceInput, type PaceClientInput, type PaceDelivery } from "../lib/leadPaceMath";

const DAYS = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19"];
const TODAY = "2026-11-20";

const client = (userId: string, over: Partial<PaceClientInput> = {}): PaceClientInput => ({
  userId, name: userId, house: false, active: true, note: null, blueCollar: true, nurse: false, leadsLeft: 10, ...over,
});
const gave = (userId: string, day: string, n: number, nurse = false): PaceDelivery => ({ userId, day, nurse, n });
const pace = (over: Partial<LeadPaceInput>) =>
  buildLeadPace({
    today: TODAY, days: DAYS, clients: [], deliveries: [], spendByDay: null, ourLeadsByDay: {}, dailyBudgetCents: null, ...over,
  });

describe("status", () => {
  it("grades an active client against the target and the floor", () => {
    expect(paceStatus(true, 5, 5, 3)).toBe("on-target");
    expect(paceStatus(true, 4.9, 5, 3)).toBe("below-target");
    expect(paceStatus(true, 3, 5, 3)).toBe("below-target");
    expect(paceStatus(true, 2.9, 5, 3)).toBe("below-floor");
    expect(paceStatus(false, 9, 5, 3)).toBe("inactive");
  });
});

describe("per client", () => {
  it("averages the last 3 full days and leaves today out", () => {
    const p = pace({
      clients: [client("a")],
      deliveries: [gave("a", "2026-11-16", 20), gave("a", "2026-11-17", 3), gave("a", "2026-11-18", 6), gave("a", "2026-11-19", 6), gave("a", TODAY, 9)],
    });
    expect(p.avgWindow).toEqual(["2026-11-17", "2026-11-18", "2026-11-19"]);
    expect(p.rows[0].avgPerDay).toBe(5);
    expect(p.rows[0].status).toBe("on-target");
    expect(p.rows[0].today).toBe(9);
    expect(p.rows[0].perDay).toEqual([0, 0, 0, 20, 3, 6, 6]);
  });

  it("splits Blue Collar and Nurse", () => {
    const p = pace({
      clients: [client("a", { nurse: true })],
      deliveries: [gave("a", "2026-11-19", 6), gave("a", "2026-11-19", 3, true)],
    });
    expect(p.rows[0].blueCollarPerDay).toBe(2);
    expect(p.rows[0].nursePerDay).toBe(1);
    expect(p.rows[0].avgPerDay).toBe(3);
  });

  it("lists the most starved active clients first and inactive ones last", () => {
    const p = pace({
      clients: [client("full"), client("out", { active: false, note: "Out of ad budget" }), client("starved"), client("short")],
      deliveries: [gave("full", "2026-11-19", 18), gave("short", "2026-11-19", 10), gave("out", "2026-11-19", 30)],
    });
    expect(p.rows.map((r) => r.userId)).toEqual(["starved", "short", "full", "out"]);
    expect(p.rows.map((r) => r.status)).toEqual(["below-floor", "below-target", "on-target", "inactive"]);
    expect(p.summary).toMatchObject({ activeClients: 3, onTarget: 1, belowTarget: 1, belowFloor: 1 });
  });
});

describe("house turn", () => {
  it("is kept off the client rows and counted on its own line", () => {
    const p = pace({
      clients: [client("a"), client("ryan", { house: true })],
      deliveries: [gave("a", "2026-11-19", 9), gave("ryan", "2026-11-19", 3), gave("ryan", TODAY, 2)],
    });
    expect(p.rows.map((r) => r.userId)).toEqual(["a"]);
    expect(p.house.perDay[6]).toBe(3);
    expect(p.house.avgPerDay).toBe(1);
    expect(p.house.today).toBe(2);
    expect(p.byDay[6]).toMatchObject({ delivered: 12, toClients: 9, toHouse: 3, clientsServed: 1, perServedClient: 9 });
    expect(p.summary.todayToHouse).toBe(2);
  });
});

describe("spend needed", () => {
  // 2 active clients need 10 a day. Clients got 18 over 3 days = 6 a day, the house 6 = 2 a day.
  const base: Partial<LeadPaceInput> = {
    clients: [client("a"), client("b"), client("ryan", { house: true })],
    deliveries: [gave("a", "2026-11-17", 6), gave("a", "2026-11-18", 6), gave("b", "2026-11-19", 6), gave("ryan", "2026-11-18", 6)],
    spendByDay: { "2026-11-17": 30000, "2026-11-18": 30000, "2026-11-19": 36000 },
    ourLeadsByDay: { "2026-11-17": 8, "2026-11-18": 8, "2026-11-19": 8 },
    dailyBudgetCents: 50000,
  };

  it("prices the shortfall at the recent cost per lead, with the house share on top", () => {
    const s = pace(base).summary;
    expect(s.clientLeadsPerDay).toBe(6);
    expect(s.perActiveClient).toBe(3);
    expect(s.neededPerDay).toBe(10);
    expect(s.gapPerDay).toBe(4);
    expect(s.surplusPerDay).toBe(0);
    expect(s.clientShare).toBe(0.75);
    expect(s.leadsToAddPerDay).toBe(5.3); // 4 ÷ 0.75
    expect(s.costPerLeadCents).toBe(4000); // $960 ÷ 24 leads
    expect(s.spendPerDayCents).toBe(32000);
    expect(s.spendChangePerDayCents).toBe(21333);
    expect(s.targetSpendPerDayCents).toBe(53333);
    expect(s.dailyBudgetCents).toBe(50000);
  });

  it("shows spend that could come off when clients are over the target", () => {
    const s = pace({ ...base, clients: [client("a"), client("b", { active: false }), client("ryan", { house: true })] }).summary;
    expect(s.neededPerDay).toBe(5);
    expect(s.gapPerDay).toBe(0);
    expect(s.surplusPerDay).toBe(1);
    expect(s.spendChangePerDayCents).toBeLessThan(0);
  });

  it("leaves the money blank when a day's spend is unknown", () => {
    const s = pace({ ...base, spendByDay: { "2026-11-17": 30000, "2026-11-18": 30000 } }).summary;
    expect(s.costPerLeadCents).toBeNull();
    expect(s.spendChangePerDayCents).toBeNull();
    expect(s.targetSpendPerDayCents).toBeNull();
    expect(s.gapPerDay).toBe(4);
    expect(pace({ ...base, spendByDay: null }).byDay[6].spendCents).toBeNull();
  });

  it("works out cost per lead for each day", () => {
    const d = pace(base).byDay;
    expect(d[6]).toMatchObject({ spendCents: 36000, costPerLeadCents: 4500 });
    expect(d[0]).toMatchObject({ spendCents: null, costPerLeadCents: null });
  });
});

describe("demand", () => {
  it("adds up the leads active clients have paid for and how long that lasts at target", () => {
    const s = pace({
      clients: [client("a", { leadsLeft: 20 }), client("b", { leadsLeft: null }), client("c", { leadsLeft: 40, active: false })],
    }).summary;
    expect(s.leadsLeft).toBe(20);
    expect(s.daysOfDemand).toBe(2); // 20 ÷ (2 active × 5)
  });

  it("counts active clients and leads a day per lead type", () => {
    const s = pace({
      clients: [client("a"), client("b", { blueCollar: false, nurse: true }), client("c", { nurse: true, active: false })],
      deliveries: [gave("a", "2026-11-19", 12), gave("b", "2026-11-19", 3, true), gave("c", "2026-11-18", 3, true)],
    }).summary;
    expect(s.blueCollar).toEqual({ activeClients: 1, leadsPerDay: 4, perClient: 4 });
    expect(s.nurse).toEqual({ activeClients: 1, leadsPerDay: 2, perClient: 2 });
  });

  it("has nothing to divide by with no active clients", () => {
    const s = pace({}).summary;
    expect(s.perActiveClient).toBeNull();
    expect(s.daysOfDemand).toBeNull();
    expect(s.neededPerDay).toBe(0);
  });
});
