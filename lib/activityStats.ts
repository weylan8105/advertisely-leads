// Activity Dashboard + Leaderboards: per-agent production numbers for a period.
//
//   Leads          leads assigned to the agent in the period
//   Dials          every dial logged in the period (lib/dials.ts; a number copy is 2
//                  since Nov 18, 2026), so a lead can count
//                  many times. A lead moved out of New Lead (any stage) with no logged
//                  dial counts as one, which is all the days before Nov 6, 2026 have.
//   Contacts       leads moved to Contacted / Follow up / Call Back or further
//   Appointments   leads moved to Call Back / Appointment or further
//   Presentations  leads moved to Presentation Ran or further (incl. Underwriting…)
//   Apps / Submitted AP  deals submitted in the period: a lead's FIRST move into
//                  Underwriting or a later deal stage, credited to whoever moved it,
//                  at the lead's AP (agents must enter it to make that move)
//   Policies / AP  leads sold (Issued PAID, Lead.soldAt) in the period + their premium
//
// Stage moves come from the "STATUS_CHANGED" lead activity. New moves carry
// metadata {stage, label, actorId}; older ones only have the text
// `Moved to "<label>" in the pipeline.`, so stages are classified by id when we
// have it and by label otherwise (agents rename/add stages, e.g. "Appointment
// Booked", "No Show'd"). Past dials, a lead counts once per level per period
// ("reached at least"). Older moves have no actor, so they credit the lead's
// current owner.

import { prisma } from "./prisma";
import { WON_STAGE_ID, CONVERSION_STAGE_IDS } from "@/data/pipeline";

export const ACTIVITY_TZ = "America/Chicago";
export const PERIODS = ["today", "wtd", "mtd", "ytd", "all"] as const;
export type Period = (typeof PERIODS)[number];

export function parsePeriod(raw: string | null | undefined): Period {
  return (PERIODS as readonly string[]).includes(raw ?? "") ? (raw as Period) : "mtd";
}

export interface ActivityStats {
  leads: number;
  dials: number;
  contacts: number;
  appointments: number;
  presentations: number;
  apps: number;
  submittedApCents: number;
  policies: number;
  apCents: number;
}

export const emptyStats = (): ActivityStats => ({
  leads: 0, dials: 0, contacts: 0, appointments: 0, presentations: 0, apps: 0, submittedApCents: 0, policies: 0, apCents: 0,
});

export function addStats(a: ActivityStats, b: ActivityStats): ActivityStats {
  return {
    leads: a.leads + b.leads,
    dials: a.dials + b.dials,
    contacts: a.contacts + b.contacts,
    appointments: a.appointments + b.appointments,
    presentations: a.presentations + b.presentations,
    apps: a.apps + b.apps,
    submittedApCents: a.submittedApCents + b.submittedApCents,
    policies: a.policies + b.policies,
    apCents: a.apCents + b.apCents,
  };
}

// 0 = not worked (New Lead, aged buckets, Issued PAID — sales are counted from
// soldAt instead), 1 dial, 2 contact, 3 appointment, 4 presentation.
const LEVEL_BY_ID: Record<string, number> = {
  "new-lead": 0,
  "aged-lead": 1, // labelled "Dialed"
  dnc: 1,
  "follow-up": 2, // labelled "Contacted"
  "call-back": 3,
  "presentation-ran": 4,
  underwriting: 4,
  approved: 4,
  "issued-not-paid": 4,
  [WON_STAGE_ID]: 4,
  chargeback: 0,
};

/** Funnel level a stage move represents. Unknown custom stages count as a dial. */
export function stageLevel(id: string | null | undefined, label: string | null | undefined): number {
  if (id && id in LEVEL_BY_ID) return LEVEL_BY_ID[id];
  const l = (label ?? "").toLowerCase();
  if (!l) return 0;
  if (/^new lead|chargeback|aged|batch/.test(l)) return 0;
  if (/issued|underwriting|approved|submitted|present|pitch|banged|broke/.test(l)) return 4;
  if (/appoint|appt|booked|scheduled|no.?show|call ?back/.test(l)) return 3;
  if (/contact|follow|spoke|talked|interested/.test(l) && !/not interested/.test(l)) return 2;
  return 1;
}

// Legacy status-dropdown changes ("Status changed from NEW to CONTACTED").
const LEVEL_BY_STATUS: Record<string, number> = { CONTACTED: 2, APPOINTMENT_SET: 3 };

/** Funnel level of a STATUS_CHANGED activity; 0 when it isn't a move up the funnel. */
export function moveLevel(body: string | null | undefined, metadata: unknown): number {
  const md = (metadata && typeof metadata === "object" ? metadata : {}) as Record<string, any>;
  if (md.stage || md.label) return stageLevel(md.stage, md.label);
  if (md.to && LEVEL_BY_STATUS[md.to]) return LEVEL_BY_STATUS[md.to];
  const m = /^Moved to "(.*)" in the pipeline\.$/.exec(body ?? "");
  return m ? stageLevel(null, m[1]) : 0;
}

/** Start of the period in the activity timezone; null for "all". */
export async function periodStart(period: Period): Promise<Date | null> {
  if (period === "all" || !prisma) return null;
  const unit = { today: "day", wtd: "week", mtd: "month", ytd: "year" }[period];
  const rows = await prisma.$queryRaw<{ since: Date }[]>`
    SELECT (date_trunc(${unit}, now() AT TIME ZONE ${ACTIVITY_TZ}) AT TIME ZONE ${ACTIVITY_TZ}) AS since`;
  return rows[0]?.since ?? null;
}

export interface StageMoveRow {
  leadId: string;
  body: string;
  metadata: any;
  ownerId: string | null;
}

export interface DialRow {
  leadId: string;
  actorId: string | null;
  /** Dials this row is worth (a number copy = 2). Missing = 1. */
  dials?: number | null;
}

/**
 * Highest funnel level each (user, lead) reached in the period, keyed
 * `${userId}\u0000${leadId}`. A move credits whoever made it (older moves: the
 * lead's owner).
 */
export function bestLevels(moves: StageMoveRow[], allowed: Set<string> | null): Map<string, number> {
  const best = new Map<string, number>();
  for (const e of moves) {
    const md = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
    const level = moveLevel(e.body, e.metadata);
    if (level <= 0) continue;
    const uid = (typeof md.actorId === "string" && md.actorId) || e.ownerId;
    if (!uid || (allowed && !allowed.has(uid))) continue;
    const key = `${uid}\u0000${e.leadId}`;
    if ((best.get(key) ?? 0) < level) best.set(key, level);
  }
  return best;
}

/** Stage moves (STATUS_CHANGED) in [since, until) on leads that aren't trashed. */
export async function stageMovesBetween(since: Date, until: Date): Promise<StageMoveRow[]> {
  if (!prisma) return [];
  return prisma.$queryRaw<StageMoveRow[]>`
    SELECT a."leadId", a.body, a.metadata, l."assignedUserId" AS "ownerId"
    FROM "LeadActivity" a
    JOIN "Lead" l ON l.id = a."leadId"
    WHERE a.type = 'STATUS_CHANGED' AND a."createdAt" >= ${since} AND a."createdAt" < ${until} AND l."trashedAt" IS NULL`;
}

/** Adds dials, contacts, appointments and presentations to each user's stats. */
export function addFunnelStats(
  moves: StageMoveRow[],
  dials: DialRow[],
  get: (userId: string) => ActivityStats,
  allowed: Set<string> | null,
) {
  const logged = new Set<string>(); // `${uid}\u0000${leadId}`
  for (const d of dials) {
    if (!d.actorId || (allowed && !allowed.has(d.actorId))) continue;
    get(d.actorId).dials += Math.max(1, Number(d.dials ?? 1) || 1);
    logged.add(`${d.actorId}\u0000${d.leadId}`);
  }

  for (const [key, level] of bestLevels(moves, allowed)) {
    const s = get(key.slice(0, key.indexOf("\u0000")));
    // A stage move only stands in for a dial when none was logged.
    if (!logged.has(key)) s.dials++;
    if (level >= 2) s.contacts++;
    if (level >= 3) s.appointments++;
    if (level >= 4) s.presentations++;
  }
}

/**
 * Stats per user for the period. `userIds` limits the result (null = everyone
 * with any activity). Trashed leads never count.
 */
export async function activityByUser(
  since: Date | null,
  userIds: string[] | null = null,
  until: Date | null = null,
): Promise<Map<string, ActivityStats>> {
  const out = new Map<string, ActivityStats>();
  if (!prisma) return out;
  if (userIds && userIds.length === 0) return out;
  const get = (uid: string) => {
    let s = out.get(uid);
    if (!s) out.set(uid, (s = emptyStats()));
    return s;
  };
  const sinceTs = since ?? new Date(0);
  // Open-ended windows run to "now" and a bit past, so nothing just logged is cut off.
  const untilTs = until ?? new Date(Date.now() + 86_400_000);

  const [leadRows, soldRows, events, dials, submitted] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedUserId"],
      where: {
        trashedAt: null,
        assignedAt: { gte: sinceTs, lt: untilTs },
        assignedUserId: userIds ? { in: userIds } : { not: null },
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["assignedUserId"],
      where: {
        trashedAt: null,
        pipelineStage: WON_STAGE_ID,
        soldAt: { gte: sinceTs, lt: untilTs },
        assignedUserId: userIds ? { in: userIds } : { not: null },
      },
      _count: { _all: true },
      _sum: { soldPremiumCents: true },
    }),
    stageMovesBetween(sinceTs, untilTs),
    prisma.$queryRaw<DialRow[]>`
      SELECT a."leadId", a.metadata->>'actorId' AS "actorId", COALESCE((a.metadata->>'dials')::int, 1) AS dials
      FROM "LeadActivity" a
      JOIN "Lead" l ON l.id = a."leadId"
      WHERE a.type = 'CALL_MADE' AND a."createdAt" >= ${sinceTs} AND a."createdAt" < ${untilTs} AND l."trashedAt" IS NULL`,
    submittedDeals(sinceTs, untilTs),
  ]);

  for (const r of leadRows) if (r.assignedUserId) get(r.assignedUserId).leads = r._count._all;
  for (const r of soldRows) {
    if (!r.assignedUserId) continue;
    const s = get(r.assignedUserId);
    s.policies = r._count._all;
    s.apCents = r._sum.soldPremiumCents ?? 0;
  }

  addFunnelStats(events, dials, get, userIds ? new Set(userIds) : null);
  const allowed = userIds ? new Set(userIds) : null;
  for (const d of submitted) {
    if (!d.userId || (allowed && !allowed.has(d.userId))) continue;
    const s = get(d.userId);
    s.apps++;
    s.submittedApCents += d.apCents;
  }
  return out;
}

export interface SubmittedDeal {
  leadId: string;
  userId: string | null; // who moved it (older moves: the lead's owner)
  apCents: number;
  at: Date;
}

/**
 * Deals submitted since `since`: each lead's first move into Underwriting or a
 * later deal stage (ever), when that first move falls in the period. AP is the
 * lead's current value, so a corrected AP shows everywhere.
 */
export async function submittedDeals(since: Date, until: Date | null = null): Promise<SubmittedDeal[]> {
  if (!prisma) return [];
  const stages = [...CONVERSION_STAGE_IDS];
  const untilTs = until ?? new Date(Date.now() + 86_400_000);
  const rows = await prisma.$queryRaw<{ leadId: string; userId: string | null; apCents: number | null; at: Date }[]>`
    SELECT f."leadId", COALESCE(f.actor, l."assignedUserId") AS "userId",
           COALESCE(l."valueCents", l."soldPremiumCents", f.ap, 0)::int AS "apCents", f.at
    FROM (
      SELECT DISTINCT ON (a."leadId") a."leadId", a."createdAt" AS at,
             a.metadata->>'actorId' AS actor, (a.metadata->>'apCents')::int AS ap
      FROM "LeadActivity" a
      WHERE a.type = 'STATUS_CHANGED' AND a.metadata->>'stage' = ANY(${stages})
      ORDER BY a."leadId", a."createdAt" ASC
    ) f
    JOIN "Lead" l ON l.id = f."leadId"
    WHERE f.at >= ${since} AND f.at < ${untilTs} AND l."trashedAt" IS NULL`;
  return rows.map((r) => ({ leadId: r.leadId, userId: r.userId, apCents: Number(r.apCents ?? 0), at: new Date(r.at) }));
}

export function hasActivity(s: ActivityStats): boolean {
  return s.leads + s.dials + s.policies > 0;
}

/**
 * Logged dials per agent between `since` and `until` (lib/dials.ts weights),
 * plus how many different leads each one dialed. Only these agents.
 */
export async function dialsByUser(since: Date, until: Date, userIds: string[]): Promise<Map<string, { dials: number; leads: number }>> {
  const out = new Map<string, { dials: number; leads: number }>();
  if (!prisma || !userIds.length) return out;
  const rows = await prisma.$queryRaw<{ actorId: string; dials: number; leads: number }[]>`
    SELECT a.metadata->>'actorId' AS "actorId",
           SUM(COALESCE((a.metadata->>'dials')::int, 1))::int AS dials,
           COUNT(DISTINCT a."leadId")::int AS leads
    FROM "LeadActivity" a
    JOIN "Lead" l ON l.id = a."leadId"
    WHERE a.type = 'CALL_MADE' AND a."createdAt" >= ${since} AND a."createdAt" < ${until}
      AND l."trashedAt" IS NULL AND a.metadata->>'actorId' = ANY(${userIds})
    GROUP BY 1`;
  for (const r of rows) out.set(r.actorId, { dials: Number(r.dials), leads: Number(r.leads) });
  return out;
}
