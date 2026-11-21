// ─── Lead Pace: are clients getting enough leads a day? ──────────────────────
// Owner, Nov 20 2026: track the leads delivered per client per day and hold it
// at a set number, so ad spend can be moved up or down to match demand.
//
//   Target          5 leads per active client per day
//   Floor           3: an active client averaging under this is being starved
//   Average         the last 3 full days (today is shown, never averaged: it's
//                   a part day)
//   Budget left     each client's unspent ad budget, and the total across all of
//                   them: the dollar size of the demand still to be filled
//   Active client   can take a lead right now: budget for at least one lead (or
//                   an open order), a lead type on, in the Program where that's
//                   required, and not on a dated pause. The house (the admins'
//                   own turn) is not a client and is shown on its own row.
//
// The spend line: leads to clients over the average window, against target ×
// active clients. A shortfall is priced at what a lead cost over the same days,
// scaled up for the share of new leads the house turn takes.
//
// Pure maths only: lib/leadPace.ts loads the numbers.

export const LEAD_PACE = {
  targetPerDay: 5,
  floorPerDay: 3,
  avgDays: 3,
  showDays: 7,
};

export type PaceStatus = "on-target" | "below-target" | "below-floor" | "inactive";

export interface PaceClientInput {
  userId: string;
  name: string;
  house: boolean;
  active: boolean;
  /** Why they're not active, or a note on an active client. */
  note: string | null;
  blueCollar: boolean;
  nurse: boolean;
  /** Leads their balance and open orders still cover. Null when it can't be counted (free leads, unknown). */
  leadsLeft: number | null;
  /** Their unspent ad budget. Null when they have no ad budget account or it can't be read. */
  budgetLeftCents?: number | null;
}

export interface PaceDelivery {
  userId: string;
  day: string; // YYYY-MM-DD in the activity timezone
  nurse: boolean;
  n: number;
}

export interface PaceRow {
  userId: string;
  name: string;
  active: boolean;
  note: string | null;
  blueCollar: boolean;
  nurse: boolean;
  perDay: number[]; // one per day in `days`
  today: number;
  avgPerDay: number; // over the average window
  blueCollarPerDay: number;
  nursePerDay: number;
  leadsLeft: number | null;
  budgetLeftCents: number | null;
  status: PaceStatus;
}

export interface PaceDay {
  day: string;
  delivered: number;
  toClients: number;
  toHouse: number;
  clientsServed: number;
  perServedClient: number | null;
  spendCents: number | null;
  costPerLeadCents: number | null;
}

export interface PaceTypeLine {
  activeClients: number;
  leadsPerDay: number; // to clients, average window
  perClient: number | null;
}

export interface PaceSummary {
  activeClients: number;
  onTarget: number;
  belowTarget: number;
  belowFloor: number;
  clientLeadsPerDay: number;
  houseLeadsPerDay: number;
  /** Recent client leads shared by today's active clients. */
  perActiveClient: number | null;
  neededPerDay: number;
  /** Client leads a day short of the target (0 when at or over it). */
  gapPerDay: number;
  /** Client leads a day over the target (0 when at or under it). */
  surplusPerDay: number;
  /** Share of delivered leads that reached clients, not the house turn. */
  clientShare: number;
  /** Leads a day to add (+) or that could come off (−) to land on the target, house turn included. */
  leadsToAddPerDay: number;
  spendPerDayCents: number | null;
  costPerLeadCents: number | null;
  /** Ad spend a day to add (+) or that could come off (−). Null when spend can't be read. */
  spendChangePerDayCents: number | null;
  targetSpendPerDayCents: number | null;
  dailyBudgetCents: number | null;
  /** Unspent ad budget across every client, active or not (a client who owes is counted as 0). */
  budgetLeftCents: number;
  /** Of that, the part held by clients who can take a lead right now. */
  activeBudgetLeftCents: number;
  /** Clients with any ad budget left. */
  budgetClients: number;
  /** Leads the active clients' balances and open orders still cover. */
  leadsLeft: number;
  /** How long that lasts at the target pace. */
  daysOfDemand: number | null;
  todayToClients: number;
  todayToHouse: number;
  blueCollar: PaceTypeLine;
  nurse: PaceTypeLine;
}

export interface LeadPace {
  target: number;
  floor: number;
  avgDays: number;
  days: string[]; // full days, oldest first
  avgWindow: string[]; // the days the averages cover
  today: string;
  rows: PaceRow[]; // clients: active first, furthest under target first
  house: { perDay: number[]; today: number; avgPerDay: number };
  byDay: PaceDay[]; // one per day in `days`
  summary: PaceSummary;
}

export interface LeadPaceInput {
  today: string;
  days: string[];
  clients: PaceClientInput[];
  deliveries: PaceDelivery[];
  /** Ad spend per day in cents. Null when Meta can't be read; a missing day counts as unknown. */
  spendByDay: Record<string, number> | null;
  /** Leads that arrived from our own campaigns per day (what the spend bought). */
  ourLeadsByDay: Record<string, number>;
  dailyBudgetCents: number | null;
  config?: Partial<typeof LEAD_PACE>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function paceStatus(active: boolean, avgPerDay: number, target: number, floor: number): PaceStatus {
  if (!active) return "inactive";
  if (avgPerDay >= target) return "on-target";
  return avgPerDay >= floor ? "below-target" : "below-floor";
}

const STATUS_ORDER: Record<PaceStatus, number> = { "below-floor": 0, "below-target": 1, "on-target": 2, inactive: 3 };

export function buildLeadPace(input: LeadPaceInput): LeadPace {
  const cfg = { ...LEAD_PACE, ...input.config };
  const { days, today } = input;
  const avgWindow = days.slice(-cfg.avgDays);
  const n = Math.max(avgWindow.length, 1);
  const inAvg = new Set(avgWindow);
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const house = new Set(input.clients.filter((c) => c.house).map((c) => c.userId));

  type Acc = { perDay: number[]; today: number; win: number; bc: number; nurse: number };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { perDay: days.map(() => 0), today: 0, win: 0, bc: 0, nurse: 0 }));
    return a;
  };
  for (const d of input.deliveries) {
    const a = get(d.userId);
    if (d.day === today) a.today += d.n;
    const i = dayIndex.get(d.day);
    if (i === undefined) continue;
    a.perDay[i] += d.n;
    if (!inAvg.has(d.day)) continue;
    a.win += d.n;
    if (d.nurse) a.nurse += d.n;
    else a.bc += d.n;
  }

  const rows: PaceRow[] = input.clients
    .filter((c) => !c.house)
    .map((c) => {
      const a = get(c.userId);
      const avgPerDay = a.win / n;
      return {
        userId: c.userId,
        name: c.name,
        active: c.active,
        note: c.note,
        blueCollar: c.blueCollar,
        nurse: c.nurse,
        perDay: a.perDay,
        today: a.today,
        avgPerDay: round1(avgPerDay),
        blueCollarPerDay: round1(a.bc / n),
        nursePerDay: round1(a.nurse / n),
        leadsLeft: c.leadsLeft,
        budgetLeftCents: c.budgetLeftCents ?? null,
        status: paceStatus(c.active, avgPerDay, cfg.targetPerDay, cfg.floorPerDay),
      };
    })
    .sort((x, y) => STATUS_ORDER[x.status] - STATUS_ORDER[y.status] || x.avgPerDay - y.avgPerDay || x.name.localeCompare(y.name));

  const houseLine = { perDay: days.map(() => 0), today: 0, win: 0 };
  for (const id of house) {
    const a = acc.get(id);
    if (!a) continue;
    a.perDay.forEach((v, i) => (houseLine.perDay[i] += v));
    houseLine.today += a.today;
    houseLine.win += a.win;
  }

  const spendOf = (day: string) => (input.spendByDay && day in input.spendByDay ? input.spendByDay[day] : null);
  const byDay: PaceDay[] = days.map((day, i) => {
    let toClients = 0;
    let served = 0;
    for (const r of rows) {
      toClients += r.perDay[i];
      if (r.perDay[i] > 0) served++;
    }
    const toHouse = houseLine.perDay[i];
    const spendCents = spendOf(day);
    const ours = input.ourLeadsByDay[day] ?? 0;
    return {
      day,
      delivered: toClients + toHouse,
      toClients,
      toHouse,
      clientsServed: served,
      perServedClient: served ? round1(toClients / served) : null,
      spendCents,
      costPerLeadCents: spendCents != null && ours > 0 ? Math.round(spendCents / ours) : null,
    };
  });

  const active = rows.filter((r) => r.active);
  const clientWin = byDay.filter((d) => inAvg.has(d.day)).reduce((s, d) => s + d.toClients, 0);
  const clientLeadsPerDay = clientWin / n;
  const houseLeadsPerDay = houseLine.win / n;
  const neededPerDay = active.length * cfg.targetPerDay;
  const diff = neededPerDay - clientLeadsPerDay; // + short, − over
  const clientShare = clientWin + houseLine.win > 0 ? clientWin / (clientWin + houseLine.win) : 1;
  // New leads split the way recent ones did, so the house turn takes its share of any added.
  const leadsToAdd = clientShare > 0 ? diff / clientShare : diff;

  const spends = avgWindow.map(spendOf);
  const spendKnown = spends.length > 0 && spends.every((s) => s != null);
  const spendWin = spendKnown ? (spends as number[]).reduce((s, v) => s + v, 0) : null;
  const oursWin = avgWindow.reduce((s, d) => s + (input.ourLeadsByDay[d] ?? 0), 0);
  const costPerLeadCents = spendWin != null && oursWin > 0 ? Math.round(spendWin / oursWin) : null;
  const spendPerDayCents = spendWin != null ? Math.round(spendWin / n) : null;
  const spendChange = costPerLeadCents != null ? Math.round(leadsToAdd * costPerLeadCents) : null;

  const typeLine = (key: "blueCollar" | "nurse"): PaceTypeLine => {
    const on = active.filter((r) => r[key]).length;
    // Summed from whole-window counts, not the rounded per-client figures.
    const total = rows.reduce((s, r) => s + (key === "blueCollar" ? get(r.userId).bc : get(r.userId).nurse), 0) / n;
    return { activeClients: on, leadsPerDay: round1(total), perClient: on ? round1(total / on) : null };
  };

  const leadsLeft = active.reduce((s, r) => s + (r.leadsLeft ?? 0), 0);
  const budgetOf = (list: PaceRow[]) => list.reduce((s, r) => s + Math.max(0, r.budgetLeftCents ?? 0), 0);
  const summary: PaceSummary = {
    activeClients: active.length,
    onTarget: active.filter((r) => r.status === "on-target").length,
    belowTarget: active.filter((r) => r.status === "below-target").length,
    belowFloor: active.filter((r) => r.status === "below-floor").length,
    clientLeadsPerDay: round1(clientLeadsPerDay),
    houseLeadsPerDay: round1(houseLeadsPerDay),
    perActiveClient: active.length ? round1(clientLeadsPerDay / active.length) : null,
    neededPerDay,
    gapPerDay: round1(Math.max(0, diff)),
    surplusPerDay: round1(Math.max(0, -diff)),
    clientShare,
    leadsToAddPerDay: round1(leadsToAdd),
    spendPerDayCents,
    costPerLeadCents,
    spendChangePerDayCents: spendChange,
    targetSpendPerDayCents: spendPerDayCents != null && spendChange != null ? Math.max(0, spendPerDayCents + spendChange) : null,
    dailyBudgetCents: input.dailyBudgetCents,
    budgetLeftCents: budgetOf(rows),
    activeBudgetLeftCents: budgetOf(active),
    budgetClients: rows.filter((r) => (r.budgetLeftCents ?? 0) > 0).length,
    leadsLeft,
    daysOfDemand: neededPerDay > 0 ? round1(leadsLeft / neededPerDay) : null,
    todayToClients: rows.reduce((s, r) => s + r.today, 0),
    todayToHouse: houseLine.today,
    blueCollar: typeLine("blueCollar"),
    nurse: typeLine("nurse"),
  };

  return {
    target: cfg.targetPerDay,
    floor: cfg.floorPerDay,
    avgDays: avgWindow.length,
    days,
    avgWindow,
    today,
    rows,
    house: { perDay: houseLine.perDay, today: houseLine.today, avgPerDay: round1(houseLeadsPerDay) },
    byDay,
    summary,
  };
}
