// The leads behind a Client Performance number: click Contacts, Appts, Apps,
// Policies… and see exactly the leads that number counted. Uses the same rules
// as lib/activityStats.ts (bestLevels, submittedDeals), so list length == count.

import { prisma } from "./prisma";
import { WON_STAGE_ID } from "@/data/pipeline";
import { bestLevels, stageMovesBetween, submittedDeals } from "./activityStats";
import { labelForStage, stagesForUser } from "./pipelineStages";

export const DRILL_METRICS = ["leads", "contacts", "appointments", "presentations", "apps", "policies"] as const;
export type DrillMetric = (typeof DRILL_METRICS)[number];

export const parseDrillMetric = (raw: string | null | undefined): DrillMetric | null =>
  (DRILL_METRICS as readonly string[]).includes(raw ?? "") ? (raw as DrillMetric) : null;

const MIN_LEVEL: Partial<Record<DrillMetric, number>> = { contacts: 2, appointments: 3, presentations: 4 };
export const DRILL_LIMIT = 500;

export interface DrillLead {
  id: string;
  name: string;
  age: number | null;
  state: string;
  phone: string;
  email: string;
  occupation: string | null;
  income: number | null;
  stage: string;
  /** Who this lead counted for (the agent credited with the move/deal). */
  creditedTo: string;
  /** Current owner of the lead. */
  owner: string | null;
  /** AP on the deal (apps: submitted AP, policies: issued AP, else the lead's value). */
  apCents: number | null;
  /** When it counted (assigned / submitted / sold), when we know it. */
  at: string | null;
  receivedAt: string;
  source: string;
}

export async function metricLeads(
  since: Date | null,
  until: Date | null,
  metric: DrillMetric,
  userId: string | null,
): Promise<{ leads: DrillLead[]; total: number }> {
  if (!prisma) return { leads: [], total: 0 };
  const sinceTs = since ?? new Date(0);
  const untilTs = until ?? new Date(Date.now() + 86_400_000);

  // leadId → { credited user, when, AP }
  const hits = new Map<string, { uid: string; at: Date | null; apCents: number | null }>();
  const add = (leadId: string, uid: string, at: Date | null, apCents: number | null) => {
    if (!hits.has(leadId)) hits.set(leadId, { uid, at, apCents });
  };

  if (metric === "leads" || metric === "policies") {
    const rows = await prisma.lead.findMany({
      where: {
        trashedAt: null,
        assignedUserId: userId ?? { not: null },
        ...(metric === "leads"
          ? { assignedAt: { gte: sinceTs, lt: untilTs } }
          : { pipelineStage: WON_STAGE_ID, soldAt: { gte: sinceTs, lt: untilTs } }),
      },
      select: { id: true, assignedUserId: true, assignedAt: true, soldAt: true, soldPremiumCents: true },
      orderBy: metric === "leads" ? { assignedAt: "desc" } : { soldAt: "desc" },
    });
    for (const r of rows) {
      add(r.id, r.assignedUserId!, metric === "leads" ? r.assignedAt : r.soldAt, metric === "policies" ? r.soldPremiumCents : null);
    }
  } else if (metric === "apps") {
    const deals = (await submittedDeals(sinceTs, untilTs))
      .filter((d) => d.userId && (!userId || d.userId === userId))
      .sort((a, b) => b.at.getTime() - a.at.getTime());
    for (const d of deals) add(d.leadId, d.userId!, d.at, d.apCents);
  } else {
    const min = MIN_LEVEL[metric]!;
    const best = bestLevels(await stageMovesBetween(sinceTs, untilTs), userId ? new Set([userId]) : null);
    for (const [key, level] of best) {
      if (level < min) continue;
      const i = key.indexOf("\u0000");
      add(key.slice(i + 1), key.slice(0, i), null, null);
    }
  }

  const total = hits.size;
  const ids = [...hits.keys()].slice(0, DRILL_LIMIT);
  if (!ids.length) return { leads: [], total };

  const rows = await prisma.lead.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, age: true, state: true, phone: true, email: true, occupation: true, income: true,
      pipelineStage: true, valueCents: true, receivedAt: true, source: true, updatedAt: true,
      assignedUserId: true,
    },
  });
  const userIds = [...new Set([...rows.map((r) => r.assignedUserId), ...ids.map((id) => hits.get(id)!.uid)].filter(Boolean) as string[])];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, email: true, pipelineStages: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: string | null) => {
    const u = id ? userById.get(id) : null;
    return u ? u.name?.trim() || u.email?.split("@")[0] || "Unknown" : null;
  };
  const rowById = new Map(rows.map((r) => [r.id, r]));

  const leads: DrillLead[] = [];
  for (const id of ids) {
    const r = rowById.get(id);
    if (!r) continue;
    const h = hits.get(id)!;
    const owner = r.assignedUserId ? userById.get(r.assignedUserId) : null;
    leads.push({
      id: r.id,
      name: r.name,
      age: r.age,
      state: r.state,
      phone: r.phone,
      email: r.email,
      occupation: r.occupation,
      income: r.income,
      stage: labelForStage(stagesForUser(owner?.pipelineStages ?? null), r.pipelineStage),
      creditedTo: nameOf(h.uid) ?? "Unknown",
      owner: nameOf(r.assignedUserId),
      apCents: h.apCents ?? r.valueCents ?? null,
      at: (h.at ?? null)?.toISOString() ?? null,
      receivedAt: r.receivedAt.toISOString(),
      source: r.source,
    });
  }
  // Funnel-level metrics have no single "when": newest-touched first.
  if (MIN_LEVEL[metric]) {
    const touched = new Map(rows.map((r) => [r.id, r.updatedAt.getTime()]));
    leads.sort((a, b) => (touched.get(b.id) ?? 0) - (touched.get(a.id) ?? 0));
  }
  return { leads, total };
}
