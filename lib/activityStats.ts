// Activity Dashboard + Leaderboards: per-agent production numbers for a period.
//
//   Leads          leads assigned to the agent in the period
//   Dials          leads moved out of New Lead (any stage) in the period
//   Contacts       leads moved to Contacted / Follow up / Call Back or further
//   Appointments   leads moved to Call Back / Appointment or further
//   Presentations  leads moved to Presentation Ran or further (incl. Underwriting…)
//   Policies / AP  leads sold (Issued PAID, Lead.soldAt) in the period + their premium
//
// Stage moves come from the "STATUS_CHANGED" lead activity. New moves carry
// metadata {stage, label, actorId}; older ones only have the text
// `Moved to "<label>" in the pipeline.`, so stages are classified by id when we
// have it and by label otherwise (agents rename/add stages, e.g. "Appointment
// Booked", "No Show'd"). A lead counts once per level per period ("reached at
// least"). Older moves have no actor, so they credit the lead's current owner.

import { prisma } from "./prisma";
import { WON_STAGE_ID } from "@/data/pipeline";

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
  policies: number;
  apCents: number;
}

export const emptyStats = (): ActivityStats => ({
  leads: 0, dials: 0, contacts: 0, appointments: 0, presentations: 0, policies: 0, apCents: 0,
});

export function addStats(a: ActivityStats, b: ActivityStats): ActivityStats {
  return {
    leads: a.leads + b.leads,
    dials: a.dials + b.dials,
    contacts: a.contacts + b.contacts,
    appointments: a.appointments + b.appointments,
    presentations: a.presentations + b.presentations,
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

/** Start of the period in the activity timezone; null for "all". */
export async function periodStart(period: Period): Promise<Date | null> {
  if (period === "all" || !prisma) return null;
  const unit = { today: "day", wtd: "week", mtd: "month", ytd: "year" }[period];
  const rows = await prisma.$queryRaw<{ since: Date }[]>`
    SELECT (date_trunc(${unit}, now() AT TIME ZONE ${ACTIVITY_TZ}) AT TIME ZONE ${ACTIVITY_TZ}) AS since`;
  return rows[0]?.since ?? null;
}

/**
 * Stats per user for the period. `userIds` limits the result (null = everyone
 * with any activity). Trashed leads never count.
 */
export async function activityByUser(since: Date | null, userIds: string[] | null = null): Promise<Map<string, ActivityStats>> {
  const out = new Map<string, ActivityStats>();
  if (!prisma) return out;
  if (userIds && userIds.length === 0) return out;
  const get = (uid: string) => {
    let s = out.get(uid);
    if (!s) out.set(uid, (s = emptyStats()));
    return s;
  };
  const sinceTs = since ?? new Date(0);

  const [leadRows, soldRows, events] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedUserId"],
      where: {
        trashedAt: null,
        assignedAt: { gte: sinceTs },
        assignedUserId: userIds ? { in: userIds } : { not: null },
      },
      _count: { _all: true },
    }),
    prisma.lead.groupBy({
      by: ["assignedUserId"],
      where: {
        trashedAt: null,
        pipelineStage: WON_STAGE_ID,
        soldAt: { gte: sinceTs },
        assignedUserId: userIds ? { in: userIds } : { not: null },
      },
      _count: { _all: true },
      _sum: { soldPremiumCents: true },
    }),
    prisma.$queryRaw<{ leadId: string; body: string; metadata: any; ownerId: string | null }[]>`
      SELECT a."leadId", a.body, a.metadata, l."assignedUserId" AS "ownerId"
      FROM "LeadActivity" a
      JOIN "Lead" l ON l.id = a."leadId"
      WHERE a.type = 'STATUS_CHANGED' AND a."createdAt" >= ${sinceTs} AND l."trashedAt" IS NULL`,
  ]);

  for (const r of leadRows) if (r.assignedUserId) get(r.assignedUserId).leads = r._count._all;
  for (const r of soldRows) {
    if (!r.assignedUserId) continue;
    const s = get(r.assignedUserId);
    s.policies = r._count._all;
    s.apCents = r._sum.soldPremiumCents ?? 0;
  }

  // Highest level each (user, lead) reached in the period.
  const allowed = userIds ? new Set(userIds) : null;
  const best = new Map<string, number>(); // `${uid}\u0000${leadId}` → level
  for (const e of events) {
    const md = e.metadata && typeof e.metadata === "object" ? e.metadata : {};
    let level: number;
    if (md.stage || md.label) level = stageLevel(md.stage, md.label);
    else if (md.to && LEVEL_BY_STATUS[md.to]) level = LEVEL_BY_STATUS[md.to];
    else {
      const m = /^Moved to "(.*)" in the pipeline\.$/.exec(e.body ?? "");
      if (!m) continue;
      level = stageLevel(null, m[1]);
    }
    if (level <= 0) continue;
    const uid = (typeof md.actorId === "string" && md.actorId) || e.ownerId;
    if (!uid || (allowed && !allowed.has(uid))) continue;
    const key = `${uid}\u0000${e.leadId}`;
    if ((best.get(key) ?? 0) < level) best.set(key, level);
  }
  for (const [key, level] of best) {
    const s = get(key.slice(0, key.indexOf("\u0000")));
    s.dials++;
    if (level >= 2) s.contacts++;
    if (level >= 3) s.appointments++;
    if (level >= 4) s.presentations++;
  }
  return out;
}

export function hasActivity(s: ActivityStats): boolean {
  return s.leads + s.dials + s.policies > 0;
}
