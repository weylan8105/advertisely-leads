// Lead Pace: loads the numbers for lib/leadPaceMath.ts (read that first).
//
//   Delivered     leads by when they were assigned, under whoever holds them now
//                 (a lead in a team Goldmine counts for the advertiser who owns it)
//   Active        advertisers the shared pool would serve right now (the same
//                 checks as sharedClientSlots, without the state), plus anyone
//                 with an open lead order
//   Budget left   the client's ad-spend balance (paid in, less card processing,
//                 less what their leads and campaigns have cost), as on Client accounts
//   Leads left    balance ÷ what one lead costs them today, plus what's still
//                 owed on open orders
//   Ad spend      our own campaigns in the three ad accounts, per day. Each ad
//                 account reports days in its own timezone, so a day's spend is
//                 a close match to a Central day, not an exact one.
//   Cost per lead that spend ÷ the leads that arrived from those campaigns

import { prisma } from "./prisma";
import { ACTIVITY_TZ } from "./activityStats";
import { addDays, dayStart, ymdInTz } from "./adPerformance";
import { getAdSpendSummary } from "./adSpend";
import { CLIENT_PAUSES } from "./clientPause";
import { HOUSE_EMAIL } from "./housePause";
import { BLUE_COLLAR_LEAD_TYPE, NURSE_LEAD_TYPE, leadTypeOn } from "./leadTypes";
import { getMetaPerformance } from "./metaInsights";
import {
  FREE_UNTIL_CPL, clientLeadPriceCents, isFreeUntilCplClient, needsFreeLeads, sharedCplCents, sharedPoolOf, withoutClientStamp,
} from "./sharedPool";
import { LEAD_PACE, buildLeadPace, type LeadPace, type PaceClientInput, type PaceDelivery } from "./leadPaceMath";

export type LeadPaceResult = LeadPace & {
  generatedAt: string;
  /** False when Meta can't be read here, so spend and cost per lead are blank. */
  spendKnown: boolean;
  warnings: string[];
};

const shortDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { timeZone: ACTIVITY_TZ, month: "short", day: "numeric" });

export async function getLeadPace(): Promise<LeadPaceResult> {
  if (!prisma) throw new Error("Database not configured");
  const now = new Date();
  const today = ymdInTz(now, ACTIVITY_TZ);
  const days = Array.from({ length: LEAD_PACE.showDays }, (_, i) => addDays(today, i - LEAD_PACE.showDays));
  const since = dayStart(days[0], ACTIVITY_TZ);
  const warnings: string[] = [];

  const [assigned, arrived, allAdvertisers, admins, openOrders, meta, cpl] = await Promise.all([
    prisma.lead.findMany({
      where: { trashedAt: null, assignedUserId: { not: null }, assignedAt: { gte: since } },
      select: { assignedUserId: true, assignedAt: true, packageId: true },
    }),
    prisma.lead.findMany({
      where: { trashedAt: null, receivedAt: { gte: since } },
      select: { receivedAt: true, source: true, rawFormData: true, campaignName: true, packageId: true },
    }),
    prisma.user.findMany({
      where: { isAdvertiser: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, leadTypes: true },
    }),
    // Admins are listed alongside the advertisers (owner, Nov 23), so their own
    // round-robin turns can be compared with every client's.
    prisma.user.findMany({
      where: { OR: [{ role: "ADMIN" }, { email: { equals: HOUSE_EMAIL, mode: "insensitive" } }] },
      select: { id: true, name: true, email: true, role: true, leadTypes: true, weeklyLeadTarget: true },
    }),
    prisma.order.findMany({
      where: { status: { in: ["PENDING", "PROCESSING", "DELIVERING"] } },
      select: { userId: true, deliverToUserId: true, quantity: true, fulfilledCount: true },
    }),
    getMetaPerformance(
      `pace:${today}`,
      (tz) => ({ since: addDays(ymdInTz(now, tz), -LEAD_PACE.showDays), until: ymdInTz(now, tz) }),
      (tz) => ({ since: addDays(ymdInTz(now, tz), -13), until: ymdInTz(now, tz) }),
      null,
    ),
    Promise.all([sharedCplCents("abca"), sharedCplCents("ew"), sharedCplCents("nurse")]),
  ]);
  const [abcaCpl, ewCpl, nurseCpl] = cpl;
  const adminIds = new Set(admins.map((a) => a.id));
  const advertisers = allAdvertisers.filter((a) => !adminIds.has(a.id));

  // Deliveries per person, day and lead type.
  const tally = new Map<string, PaceDelivery>();
  for (const l of assigned) {
    if (!l.assignedUserId || !l.assignedAt) continue;
    const day = ymdInTz(l.assignedAt, ACTIVITY_TZ);
    const nurse = l.packageId === NURSE_LEAD_TYPE;
    const key = `${l.assignedUserId}\u0000${day}\u0000${nurse ? 1 : 0}`;
    const row = tally.get(key);
    if (row) row.n++;
    else tally.set(key, { userId: l.assignedUserId, day, nurse, n: 1 });
  }
  const deliveries = [...tally.values()];
  const avgWindow = new Set(days.slice(-LEAD_PACE.avgDays));
  const recentlyServed = new Set(deliveries.filter((d) => d.day === today || avgWindow.has(d.day)).map((d) => d.userId));

  // Leads our own campaigns produced, per day: what the spend bought.
  const ourLeadsByDay: Record<string, number> = {};
  for (const l of arrived) {
    if (sharedPoolOf({ ...l, rawFormData: withoutClientStamp(l.rawFormData) }) === null) continue;
    const day = ymdInTz(l.receivedAt, ACTIVITY_TZ);
    ourLeadsByDay[day] = (ourLeadsByDay[day] ?? 0) + 1;
  }

  // Open orders, by who the leads go to.
  const owed = new Map<string, number>();
  for (const o of openOrders) {
    const left = o.quantity - o.fulfilledCount;
    if (left <= 0) continue;
    const to = o.deliverToUserId ?? o.userId;
    owed.set(to, (owed.get(to) ?? 0) + left);
  }

  const advertiserIds = new Set(advertisers.map((a) => a.id));
  const otherIds = [...new Set([...deliveries.map((d) => d.userId), ...owed.keys()])].filter((id) => !advertiserIds.has(id) && !adminIds.has(id));
  const others = otherIds.length
    ? await prisma.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, name: true, email: true, role: true } })
    : [];

  const isHouse = (u: { email: string | null; role: unknown }) =>
    u.role === "ADMIN" || (u.email ?? "").trim().toLowerCase() === HOUSE_EMAIL;
  const displayName = (u: { name: string | null; email: string | null }) => u.name?.trim() || (u.email ?? "").split("@")[0] || "Unnamed";
  const pauseOf = (userId: string) =>
    CLIENT_PAUSES.find((p) => p.userId === userId && now >= new Date(p.from) && now < new Date(p.until));
  const pausedNote = (until: string) => `Paused through ${shortDay(new Date(new Date(until).getTime() - 1).toISOString())}`;

  const summaries = await Promise.all(
    advertisers.map((a) => (isHouse(a) ? Promise.resolve(null) : getAdSpendSummary(a.id).catch(() => null))),
  );

  const clients: PaceClientInput[] = [];
  for (const [i, a] of advertisers.entries()) {
    const base = { userId: a.id, name: displayName(a) };
    if (isHouse(a)) {
      clients.push({ ...base, house: true, active: false, note: null, blueCollar: false, nurse: false, leadsLeft: null });
      continue;
    }
    const blueCollar = leadTypeOn(a.leadTypes, BLUE_COLLAR_LEAD_TYPE);
    const nurse = leadTypeOn(a.leadTypes, NURSE_LEAD_TYPE);
    const orderLeft = owed.get(a.id) ?? 0;
    const row = { ...base, house: false, blueCollar, nurse };
    const inactive = (note: string) => clients.push({ ...row, active: false, note, leadsLeft: orderLeft || null });
    const paused = pauseOf(a.id);
    if (paused) { inactive(pausedNote(paused.until)); continue; }
    if (orderLeft > 0 && !blueCollar && !nurse) {
      clients.push({ ...row, active: true, note: "Open order", leadsLeft: orderLeft });
      continue;
    }
    if (!blueCollar && !nurse) { inactive("No lead type switched on"); continue; }
    const s = summaries[i];
    if (!s || s.errors.length) {
      // Still counted as active when leads are reaching them: one failed read
      // shouldn't shrink the client count and make the pace look better than it is.
      warnings.push(`${base.name}: balance could not be read`);
      if (orderLeft > 0 || recentlyServed.has(a.id)) clients.push({ ...row, active: true, note: "Balance could not be read", leadsLeft: orderLeft || null });
      else inactive("Balance could not be read");
      continue;
    }
    if (s.program.mustJoin) {
      if (orderLeft > 0) clients.push({ ...row, active: true, note: "Open order", leadsLeft: orderLeft });
      else inactive("Not in the Advertiser Program");
      continue;
    }
    if (isFreeUntilCplClient(a.email) && needsFreeLeads(s)) {
      clients.push({ ...row, active: true, note: `Free leads while their cost per lead is over $${FREE_UNTIL_CPL.targetCents / 100}`, leadsLeft: null });
      continue;
    }
    // What one lead costs them today, per lead type they take.
    const prices = [
      ...(blueCollar ? [clientLeadPriceCents(Math.round((abcaCpl + ewCpl) / 2), s)] : []),
      ...(nurse ? [clientLeadPriceCents(nurseCpl, s)] : []),
    ];
    const cheapest = Math.min(...prices);
    const typical = prices.reduce((x, y) => x + y, 0) / prices.length;
    if (s.balanceCents < cheapest && orderLeft <= 0) { inactive("Out of ad budget"); continue; }
    const budgetLeads = s.balanceCents >= cheapest ? Math.floor(s.balanceCents / typical) : 0;
    clients.push({ ...row, active: true, note: null, leadsLeft: budgetLeads + orderLeft });
  }
  // Admins: a normal row. Active while they're in the rotation (a weekly lead
  // target and a lead type on). They pay through the admin lead balance, not an
  // ad budget, so budget and leads left stay blank.
  for (const a of admins) {
    const blueCollar = leadTypeOn(a.leadTypes, BLUE_COLLAR_LEAD_TYPE);
    const nurse = leadTypeOn(a.leadTypes, NURSE_LEAD_TYPE);
    const row = { userId: a.id, name: displayName(a), house: false, admin: true, blueCollar, nurse, leadsLeft: null };
    const paused = pauseOf(a.id);
    if (paused) clients.push({ ...row, active: false, note: `Admin · ${pausedNote(paused.until)}` });
    else if (!(a.weeklyLeadTarget ?? 0)) clients.push({ ...row, active: false, note: "Admin · no weekly lead target" });
    else if (!blueCollar && !nurse) clients.push({ ...row, active: false, note: "Admin · no lead type switched on" });
    else clients.push({ ...row, active: true, note: `Admin · up to ${a.weeklyLeadTarget} a week` });
  }
  for (const u of others) {
    const base = { userId: u.id, name: displayName(u), blueCollar: false, nurse: false };
    if (isHouse(u)) { clients.push({ ...base, house: true, active: false, note: null, leadsLeft: null }); continue; }
    const orderLeft = owed.get(u.id) ?? 0;
    const paused = pauseOf(u.id);
    if (paused) clients.push({ ...base, house: false, active: false, note: pausedNote(paused.until), leadsLeft: orderLeft || null });
    else if (orderLeft > 0) clients.push({ ...base, house: false, active: true, note: "Lead order", leadsLeft: orderLeft });
    else clients.push({ ...base, house: false, active: false, note: "No open order or ad budget", leadsLeft: null });
  }

  // Unspent ad budget, for every advertiser whose balance could be read.
  const budgetLeft = new Map<string, number>();
  for (const [i, a] of advertisers.entries()) {
    const s = summaries[i];
    if (s && !s.errors.length) budgetLeft.set(a.id, s.balanceCents);
  }
  for (const c of clients) c.budgetLeftCents = c.house ? null : budgetLeft.get(c.userId) ?? null;

  // Ad spend per day, all three ad accounts. Blank when any of them can't be read.
  const spendKnown = meta.configured && meta.missing.length === 0;
  let spendByDay: Record<string, number> | null = null;
  if (spendKnown) {
    spendByDay = Object.fromEntries(days.map((d) => [d, 0]));
    for (const [key, cents] of Object.entries(meta.dailySpendCents)) {
      const day = key.slice(0, 10);
      if (day in spendByDay) spendByDay[day] += cents;
    }
  } else if (meta.configured) {
    warnings.push(`Ad spend could not be read for: ${meta.missing.join(", ")}`);
  }
  const budgets = meta.campaigns.filter((c) => c.status === "ACTIVE" && c.dailyBudgetCents).map((c) => c.dailyBudgetCents as number);
  const dailyBudgetCents = spendKnown && budgets.length ? budgets.reduce((s, v) => s + v, 0) : null;

  return {
    ...buildLeadPace({ today, days, clients, deliveries, spendByDay, ourLeadsByDay, dailyBudgetCents }),
    generatedAt: now.toISOString(),
    spendKnown,
    warnings,
  };
}
