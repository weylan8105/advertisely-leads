// Ad Performance dashboard: what Meta spent and showed, next to what those leads
// became in the CRM, for one window.
//
//   New leads      leads received in the window
//   Dials          every dial logged in the window (lib/dials.ts), so one lead can
//                  count many times. A lead moved out of New Lead with no logged dial
//                  counts as one, which is all the days before DIALS_TRACKED_FROM have.
//   Contacted      leads moved to Contacted or further in the window
//   Dials per      average dials a lead took before it first reached Contacted, for
//   contact        leads first worked since DIALS_TRACKED_FROM
//   Applications   leads that FIRST reached Underwriting, Approved, Issued Not Paid
//                  or Issued PAID in the window. Once per lead, and a later decline
//                  doesn't undo it: the application was still submitted.
//   Issued PAID    leads sold in the window (Lead.soldAt)
//   CPA            ad spend / applications (cost per application)
//   CAC            ad spend / Issued PAID
//
// Counts are by when each thing happened, not when the lead came in, so a window
// reads like Ads Manager does. Client campaigns and their leads are left out.

import { prisma } from "./prisma";
import { ACTIVITY_TZ, moveLevel } from "./activityStats";
import { CONVERSION_STAGE_IDS, WON_STAGE_ID, stageLabel } from "@/data/pipeline";
import { ADVERTISER_NAME_KEY } from "./leadOrigin";
import { getMetaPerformance, type CampaignPerf, type PerfFunnel } from "./metaInsights";

export const PERF_RANGES = ["today", "yesterday", "7d", "30d", "shared"] as const;
export type PerfRange = (typeof PERF_RANGES)[number];

// The first day both funnels were live and tracked. Blue Collar spent nothing
// Aug 23 to Sep 13, and the ABCA pages only opened Aug 31.
const SHARED_START = "2026-09-14";
const TREND_DAYS = 14;
// Meta keeps pixel stats for 28 days.
const PIXEL_STATS_DAYS = 27;
const ABCA_SOURCE = "early-retirement-quiz";
// When dials started being logged. A lead worked before this had dials we never
// saw, so measuring it would make dials per contact read too low.
export const DIALS_TRACKED_FROM = new Date("2026-11-06T18:30:00Z");

export function parsePerfRange(raw: string | null | undefined): PerfRange {
  return (PERF_RANGES as readonly string[]).includes(raw ?? "") ? (raw as PerfRange) : "today";
}

export const ymdInTz = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Midnight at the start of a calendar day in a timezone. */
export function dayStart(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]),
  );
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(guess - (shown - guess));
}

/** A window's first and last calendar day, given today's date. */
export function rangeDays(range: PerfRange, today: string): { since: string; until: string } {
  if (range === "today") return { since: today, until: today };
  if (range === "yesterday") return { since: addDays(today, -1), until: addDays(today, -1) };
  if (range === "7d") return { since: addDays(today, -6), until: today };
  if (range === "30d") return { since: addDays(today, -29), until: today };
  return { since: SHARED_START, until: today };
}

export interface PerfLead {
  id: string;
  source: string | null;
  campaignName: string | null;
  utmCampaign: string | null;
  rawCampaign: string | null;
  assignedUserId: string | null;
  receivedAt: Date;
  pipelineStage: string;
  soldAt: Date | null;
  soldPremiumCents: number | null;
}

export interface PerfMove {
  leadId: string;
  body: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface PerfDial {
  leadId: string;
  createdAt: Date;
}

export interface PerfCounts {
  leads: number;
  dials: number;
  leadsDialed: number;
  contacted: number;
  // Contacts measured for dials per contact, and the dials they took.
  reached: number;
  dialsToReach: number;
  applications: number;
  issuedPaid: number;
  premiumCents: number;
}

export type PerfKind = "lead" | "dial" | "moved" | "contacted" | "reached" | "application" | "paid";
export interface PerfEvent {
  leadId: string;
  kind: PerfKind;
  at: Date;
  premiumCents?: number;
  dials?: number;
}

export const emptyCounts = (): PerfCounts => ({
  leads: 0, dials: 0, leadsDialed: 0, contacted: 0, reached: 0, dialsToReach: 0, applications: 0, issuedPaid: 0, premiumCents: 0,
});

export const funnelOf = (lead: { source?: string | null }): PerfFunnel => (lead.source === ABCA_SOURCE ? "abca" : "ew");

const CONVERSION_LABELS = new Set<string>(CONVERSION_STAGE_IDS.map((id) => stageLabel(id)));

/** True when this activity put a lead into a stage that counts as an application. */
export function isApplicationMove(body: string | null | undefined, metadata: unknown): boolean {
  const md = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, any>;
  if (md.stage) return (CONVERSION_STAGE_IDS as readonly string[]).includes(md.stage);
  if ((body ?? "").startsWith("Conversion reported via API")) return true;
  const m = /^Moved to "(.*)" in the pipeline\.$/.exec(body ?? "");
  return !!m && CONVERSION_LABELS.has(m[1]);
}

/** Everything that happened to these leads, as dated events. */
export function perfEvents(leads: PerfLead[], moves: PerfMove[], dials: PerfDial[] = []): PerfEvent[] {
  const known = new Set(leads.map((l) => l.id));
  const events: PerfEvent[] = [];
  const firstApplication = new Map<string, Date>();
  const firstWorked = new Map<string, Date>();
  const firstContact = new Map<string, Date>();
  const earliest = (map: Map<string, Date>, leadId: string, at: Date) => {
    const first = map.get(leadId);
    if (!first || at < first) map.set(leadId, at);
  };
  for (const l of leads) {
    events.push({ leadId: l.id, kind: "lead", at: l.receivedAt });
    if (l.pipelineStage === WON_STAGE_ID && l.soldAt) {
      events.push({ leadId: l.id, kind: "paid", at: l.soldAt, premiumCents: l.soldPremiumCents ?? 0 });
    }
  }
  for (const m of moves) {
    if (!known.has(m.leadId)) continue;
    const level = moveLevel(m.body, m.metadata);
    if (level >= 1) {
      events.push({ leadId: m.leadId, kind: "moved", at: m.createdAt });
      earliest(firstWorked, m.leadId, m.createdAt);
    }
    if (level >= 2) {
      events.push({ leadId: m.leadId, kind: "contacted", at: m.createdAt });
      earliest(firstContact, m.leadId, m.createdAt);
    }
    if (isApplicationMove(m.body, m.metadata)) earliest(firstApplication, m.leadId, m.createdAt);
  }
  for (const [leadId, at] of firstApplication) events.push({ leadId, kind: "application", at });

  const dialTimes = new Map<string, Date[]>();
  for (const d of dials) {
    if (!known.has(d.leadId)) continue;
    events.push({ leadId: d.leadId, kind: "dial", at: d.createdAt });
    dialTimes.set(d.leadId, [...(dialTimes.get(d.leadId) ?? []), d.createdAt]);
  }
  for (const [leadId, at] of firstContact) {
    if ((firstWorked.get(leadId) ?? at) < DIALS_TRACKED_FROM) continue;
    // Reaching Contacted took at least one call, logged or not.
    const before = (dialTimes.get(leadId) ?? []).filter((t) => t <= at).length;
    events.push({ leadId, kind: "reached", at, dials: Math.max(before, 1) });
  }
  return events;
}

/** Counts per key for a window; each lead counts once per kind, except dials. */
export function tally(
  events: PerfEvent[],
  since: Date,
  until: Date,
  keyOf: (leadId: string) => string,
): Map<string, PerfCounts> {
  const out = new Map<string, PerfCounts>();
  const seen = new Set<string>();
  const inWindow = events.filter((e) => e.at >= since && e.at < until);
  const logged = new Set(inWindow.filter((e) => e.kind === "dial").map((e) => e.leadId));
  for (const e of inWindow) {
    // A stage move only stands in for a dial when none was logged.
    if (e.kind === "moved" && logged.has(e.leadId)) continue;
    const key = keyOf(e.leadId);
    let c = out.get(key);
    if (!c) out.set(key, (c = emptyCounts()));
    if (e.kind === "dial") c.dials++;
    const once = `${key}\u0000${e.kind}\u0000${e.leadId}`;
    if (seen.has(once)) continue;
    seen.add(once);
    if (e.kind === "lead") c.leads++;
    else if (e.kind === "dial") c.leadsDialed++;
    else if (e.kind === "moved") {
      c.dials++;
      c.leadsDialed++;
    } else if (e.kind === "contacted") c.contacted++;
    else if (e.kind === "reached") {
      c.reached++;
      c.dialsToReach += e.dials ?? 1;
    } else if (e.kind === "application") c.applications++;
    else {
      c.issuedPaid++;
      c.premiumCents += e.premiumCents ?? 0;
    }
  }
  return out;
}

export const costPer = (cents: number, n: number) => (n > 0 ? Math.round(cents / n) : null);

export interface PerfSummary extends PerfCounts {
  // False when Meta wouldn't return the spend: costs are then unknown, not zero.
  spendKnown: boolean;
  spendCents: number;
  impressions: number;
  clicks: number;
  linkClicks: number;
  metaLeads: number;
  activeBudgetCents: number;
  dialsPerContact: number | null;
  cplCents: number | null;
  cpaCents: number | null;
  cacCents: number | null;
  cpmCents: number | null;
  ctrPct: number | null;
}

/** Add Meta's numbers to the CRM counts and work out the costs. */
export function summarize(counts: PerfCounts, campaigns: CampaignPerf[], spendKnown = true): PerfSummary {
  const sum = (f: (c: CampaignPerf) => number) => campaigns.reduce((n, c) => n + f(c), 0);
  const spendCents = sum((c) => c.spendCents);
  const impressions = sum((c) => c.impressions);
  const clicks = sum((c) => c.clicks);
  return {
    ...counts,
    spendKnown,
    spendCents,
    impressions,
    clicks,
    linkClicks: sum((c) => c.linkClicks),
    metaLeads: sum((c) => c.metaLeads),
    activeBudgetCents: sum((c) => c.dailyBudgetCents ?? 0),
    dialsPerContact: counts.reached > 0 ? Math.round((counts.dialsToReach / counts.reached) * 10) / 10 : null,
    cplCents: spendKnown ? costPer(spendCents, counts.leads) : null,
    cpaCents: spendKnown ? costPer(spendCents, counts.applications) : null,
    cacCents: spendKnown ? costPer(spendCents, counts.issuedPaid) : null,
    cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
    ctrPct: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : null,
  };
}

export const addCounts = (a: PerfCounts, b: PerfCounts): PerfCounts => ({
  leads: a.leads + b.leads,
  dials: a.dials + b.dials,
  leadsDialed: a.leadsDialed + b.leadsDialed,
  contacted: a.contacted + b.contacted,
  reached: a.reached + b.reached,
  dialsToReach: a.dialsToReach + b.dialsToReach,
  applications: a.applications + b.applications,
  issuedPaid: a.issuedPaid + b.issuedPaid,
  premiumCents: a.premiumCents + b.premiumCents,
});

/** The campaign a lead came from: its Meta id, or its name when that's all it kept. */
export function campaignKeyOf(lead: PerfLead, idByName: Map<string, string>): string | null {
  if (/^\d+$/.test(lead.utmCampaign ?? "")) return lead.utmCampaign;
  if (lead.rawCampaign) return lead.rawCampaign;
  return idByName.get(lead.campaignName ?? "") ?? idByName.get(lead.utmCampaign ?? "") ?? null;
}

// Every name an event has had, so history stays on one row.
const EVENT_ROWS: { stage: string; events: string[]; compare: boolean }[] = [
  { stage: "New quiz lead", events: ["Lead"], compare: false },
  { stage: "New instant form lead", events: ["Contact", "InstantFormLead"], compare: true },
  { stage: "Underwriting", events: ["SubmitApplication"], compare: true },
  { stage: "Approved", events: ["CompleteRegistration", "Approved"], compare: true },
  { stage: "Issued Not Paid", events: ["AddPaymentInfo", "IssuedNotPaid"], compare: true },
  { stage: "Issued PAID", events: ["Purchase"], compare: true },
];

export interface PerfEventRow {
  stage: string;
  event: string;
  sent: number;
  failed: number;
  shown: number | null;
}

/** What Advertisely sent Meta in the window, next to what the pixels show. */
export function eventRows(ctas: (string | null)[], pixelEvents: Record<string, number> | null): PerfEventRow[] {
  const sent = new Map<string, number>();
  const failed = new Map<string, number>();
  for (const cta of ctas) {
    const ok = /^ok (\S+)/.exec(cta ?? "");
    const bad = /^error (\S+)/.exec(cta ?? "");
    if (ok) {
      const name = ok[1].startsWith("lead:") ? "Lead" : ok[1];
      sent.set(name, (sent.get(name) ?? 0) + 1);
    } else if (bad) failed.set(bad[1], (failed.get(bad[1]) ?? 0) + 1);
  }
  const total = (m: Map<string, number>, names: string[]) => names.reduce((n, e) => n + (m.get(e) ?? 0), 0);
  return EVENT_ROWS.map((r) => ({
    stage: r.stage,
    event: r.events[0],
    sent: total(sent, r.events),
    failed: total(failed, r.events),
    shown: r.compare && pixelEvents ? r.events.reduce((n, e) => n + (pixelEvents[e] ?? 0), 0) : null,
  }));
}

export interface PerfDealRow {
  agent: string;
  underwriting: number;
  approved: number;
  issuedNotPaid: number;
  issuedPaid: number;
  // Got an application in, then left those stages (declined, moved back).
  leftStages: number;
  applications: number;
  premiumCents: number;
}

/**
 * Every deal so far, by who holds it now. Not tied to a window: the stage columns
 * are the counts Client Accounts shows, so the two can be checked against each other.
 */
export function dealsByAgent(leads: PerfLead[], events: PerfEvent[], agentName: (userId: string) => string): PerfDealRow[] {
  const applied = new Set(events.filter((e) => e.kind === "application").map((e) => e.leadId));
  const rows = new Map<string, PerfDealRow>();
  for (const l of leads) {
    const inStage = (CONVERSION_STAGE_IDS as readonly string[]).includes(l.pipelineStage);
    if (!inStage && !applied.has(l.id)) continue;
    const agent = l.assignedUserId ? agentName(l.assignedUserId) : "Unassigned";
    let row = rows.get(agent);
    if (!row) {
      row = { agent, underwriting: 0, approved: 0, issuedNotPaid: 0, issuedPaid: 0, leftStages: 0, applications: 0, premiumCents: 0 };
      rows.set(agent, row);
    }
    row.applications++;
    if (l.pipelineStage === "underwriting") row.underwriting++;
    else if (l.pipelineStage === "approved") row.approved++;
    else if (l.pipelineStage === "issued-not-paid") row.issuedNotPaid++;
    else if (l.pipelineStage === WON_STAGE_ID) {
      row.issuedPaid++;
      row.premiumCents += l.soldPremiumCents ?? 0;
    } else row.leftStages++;
  }
  return [...rows.values()].sort((a, b) => b.applications - a.applications || a.agent.localeCompare(b.agent));
}

export interface PerfDay {
  date: string;
  ew: { spendCents: number; leads: number; applications: number; issuedPaid: number };
  abca: { spendCents: number; leads: number; applications: number; issuedPaid: number };
}

export interface PerfCampaignRow extends PerfSummary {
  campaignId: string;
  name: string;
  funnel: PerfFunnel;
  status: string | null;
  dailyBudgetCents: number | null;
}

export interface AdPerformance {
  range: PerfRange;
  since: string;
  until: string;
  fetchedAt: string;
  metaConfigured: boolean;
  missing: PerfFunnel[];
  errors: string[];
  funnels: { all: PerfSummary; ew: PerfSummary; abca: PerfSummary };
  campaigns: PerfCampaignRow[];
  noCampaign: PerfCounts;
  deals: PerfDealRow[];
  daily: PerfDay[];
  events: PerfEventRow[];
}

export async function getAdPerformance(range: PerfRange): Promise<AdPerformance> {
  if (!prisma) throw new Error("Database not configured");
  const now = new Date();
  const today = ymdInTz(now, ACTIVITY_TZ);
  const days = rangeDays(range, today);
  const since = dayStart(days.since, ACTIVITY_TZ);
  const until = dayStart(addDays(days.until, 1), ACTIVITY_TZ);

  const pixelCutoff = new Date(now.getTime() - PIXEL_STATS_DAYS * 86_400_000);
  const pixelWindow = { since: since < pixelCutoff ? pixelCutoff : since, until: until > now ? now : until };

  const [meta, leads, moves, sends, users, dials] = await Promise.all([
    getMetaPerformance(
      `${range}:${today}`,
      (tz) => rangeDays(range, ymdInTz(now, tz)),
      (tz) => ({ since: addDays(ymdInTz(now, tz), 1 - TREND_DAYS), until: ymdInTz(now, tz) }),
      pixelWindow,
    ),
    prisma.$queryRaw<PerfLead[]>`
      SELECT id, source, "campaignName", "utmCampaign", "assignedUserId",
             substring("rawFormData"::text from 'campaignId[^0-9]{1,12}([0-9]{10,})') AS "rawCampaign",
             "receivedAt", "pipelineStage", "soldAt", "soldPremiumCents"
      FROM "Lead"
      WHERE "trashedAt" IS NULL
        AND NOT jsonb_exists("rawFormData", ${ADVERTISER_NAME_KEY})
        AND COALESCE("campaignName", '') NOT LIKE 'Advertisely Advertiser%'`,
    prisma.$queryRaw<PerfMove[]>`
      SELECT "leadId", body, metadata, "createdAt" FROM "LeadActivity" WHERE type = 'STATUS_CHANGED'`,
    prisma.funnelEvent.findMany({
      where: { source: "meta-capi", createdAt: { gte: since, lt: until } },
      select: { cta: true },
    }),
    prisma.user.findMany({ select: { id: true, name: true, email: true } }),
    prisma.leadActivity.findMany({ where: { type: "CALL_MADE" }, select: { leadId: true, createdAt: true } }),
  ]);

  const leadById = new Map(leads.map((l) => [l.id, l]));
  const events = perfEvents(leads, moves, dials);
  const userById = new Map(users.map((u) => [u.id, u]));
  const agentName = (id: string) => userById.get(id)?.name?.trim() || userById.get(id)?.email || "Unknown agent";
  const funnelKey = (id: string) => funnelOf(leadById.get(id) ?? { source: null });

  const byFunnel = tally(events, since, until, funnelKey);
  const ewCounts = byFunnel.get("ew") ?? emptyCounts();
  const abcaCounts = byFunnel.get("abca") ?? emptyCounts();
  const funnelCampaigns = (f: PerfFunnel) => meta.campaigns.filter((c) => c.funnel === f);

  const idByName = new Map(meta.campaigns.map((c) => [c.name, c.campaignId]));
  const byCampaign = tally(events, since, until, (id) => {
    const lead = leadById.get(id);
    return (lead && campaignKeyOf(lead, idByName)) ?? "";
  });
  const campaigns: PerfCampaignRow[] = meta.campaigns
    .map((c) => ({
      ...summarize(byCampaign.get(c.campaignId) ?? emptyCounts(), [c]),
      campaignId: c.campaignId,
      name: c.name,
      funnel: c.funnel,
      status: c.status,
      dailyBudgetCents: c.dailyBudgetCents,
    }))
    .filter((c) => c.spendCents > 0 || c.leads + c.applications + c.issuedPaid > 0 || c.status === "ACTIVE")
    .sort((a, b) => b.spendCents - a.spendCents);
  const listed = new Set(meta.campaigns.map((c) => c.campaignId));
  const noCampaign = [...byCampaign.entries()]
    .filter(([key]) => !listed.has(key))
    .reduce((sum, [, c]) => addCounts(sum, c), emptyCounts());

  const daily: PerfDay[] = [];
  for (let i = TREND_DAYS - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const counts = tally(events, dayStart(date, ACTIVITY_TZ), dayStart(addDays(date, 1), ACTIVITY_TZ), funnelKey);
    const day = (f: PerfFunnel) => {
      const c = counts.get(f) ?? emptyCounts();
      return { spendCents: meta.dailySpendCents[`${date}:${f}`] ?? 0, leads: c.leads, applications: c.applications, issuedPaid: c.issuedPaid };
    };
    daily.push({ date, ew: day("ew"), abca: day("abca") });
  }

  return {
    range,
    since: days.since,
    until: days.until,
    fetchedAt: now.toISOString(),
    metaConfigured: meta.configured,
    missing: meta.missing,
    errors: meta.errors,
    funnels: {
      all: summarize(addCounts(ewCounts, abcaCounts), meta.campaigns, meta.missing.length === 0),
      ew: summarize(ewCounts, funnelCampaigns("ew"), !meta.missing.includes("ew")),
      abca: summarize(abcaCounts, funnelCampaigns("abca"), !meta.missing.includes("abca")),
    },
    campaigns,
    noCampaign,
    deals: dealsByAgent(leads, events, agentName),
    daily,
    events: eventRows(sends.map((s) => s.cta), meta.pixelEvents),
  };
}
