// The leads behind an Ad Performance number (New leads, Leads dialed, Contacted,
// Applications, Issued PAID) for a funnel or one campaign. Built from the same
// events and window as getAdPerformance (loadPerfBase), so the list matches the count.

import { loadPerfBase, type PerfKind, type PerfRange } from "./adPerformance";
import { drillCards, DRILL_LIMIT, type DrillHits, type DrillLead } from "./clientPerformanceLeads";

export const PERF_DRILL_METRICS = ["leads", "dialed", "contacted", "applications", "issuedPaid"] as const;
export type PerfDrillMetric = (typeof PERF_DRILL_METRICS)[number];

export const parsePerfDrillMetric = (raw: string | null | undefined): PerfDrillMetric | null =>
  (PERF_DRILL_METRICS as readonly string[]).includes(raw ?? "") ? (raw as PerfDrillMetric) : null;

const KINDS: Record<PerfDrillMetric, PerfKind[]> = {
  leads: ["lead"],
  dialed: ["dial", "moved"],
  contacted: ["contacted"],
  applications: ["application"],
  issuedPaid: ["paid"],
};

/** scope: "all" | "ew" | "abca" | "ewws" | "campaign:<id>" | "none" (leads with no listed campaign) */
export async function perfLeads(
  range: PerfRange,
  from: string | null,
  to: string | null,
  metric: PerfDrillMetric,
  scope: string,
): Promise<{ leads: DrillLead[]; total: number; limit: number }> {
  const { since, until, events, funnelKey, campaignKey, meta } = await loadPerfBase(range, from, to);
  const listed = new Set(meta.campaigns.map((c) => c.campaignId));
  const inScope = (leadId: string) => {
    if (scope === "all") return true;
    if (scope === "none") return !listed.has(campaignKey(leadId));
    if (scope.startsWith("campaign:")) return campaignKey(leadId) === scope.slice(9);
    return funnelKey(leadId) === scope;
  };
  const kinds = new Set(KINDS[metric]);
  const matched = events
    .filter((e) => kinds.has(e.kind) && e.at >= since && e.at < until && inScope(e.leadId))
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const hits: DrillHits = new Map();
  for (const e of matched) {
    if (!hits.has(e.leadId)) hits.set(e.leadId, { uid: null, at: e.at, apCents: metric === "issuedPaid" ? e.premiumCents ?? null : null });
  }
  const cards = await drillCards(hits);
  return { leads: cards.map(({ touchedAt, ...l }) => l), total: hits.size, limit: DRILL_LIMIT };
}
