// Production totals across every agent on Advertisely: the live stats strip on
// the public homepage (app/api/stats/live, always the rolling 30 days) and the
// admin Client Performance page (app/api/admin/live-stats, any range below).
// Same numbers as the leaderboard (lib/activityStats.ts), summed over a window.

import { ACTIVITY_TZ, activityByUser, addStats, emptyStats, type ActivityStats } from "./activityStats";
import { addDays, dayStart, ymdInTz } from "./adPerformance";

export const LIVE_STATS_DAYS = 30;

// "30d" is the homepage's rolling window (now − 30 days), so the two always match.
// Today / Yesterday / 7 days are calendar days in Central time, like Ad Performance.
export const CLIENT_RANGES = ["today", "yesterday", "7d", "30d", "all"] as const;
export type ClientRange = (typeof CLIENT_RANGES)[number];

export function parseClientRange(raw: string | null | undefined): ClientRange {
  return (CLIENT_RANGES as readonly string[]).includes(raw ?? "") ? (raw as ClientRange) : "30d";
}

export function rangeWindow(range: ClientRange, now = new Date()): { since: Date | null; until: Date | null } {
  const today = ymdInTz(now, ACTIVITY_TZ);
  if (range === "today") return { since: dayStart(today, ACTIVITY_TZ), until: null };
  if (range === "yesterday") return { since: dayStart(addDays(today, -1), ACTIVITY_TZ), until: dayStart(today, ACTIVITY_TZ) };
  if (range === "7d") return { since: dayStart(addDays(today, -6), ACTIVITY_TZ), until: null };
  if (range === "all") return { since: null, until: null };
  return { since: new Date(now.getTime() - LIVE_STATS_DAYS * 86_400_000), until: null };
}

export interface LiveStats {
  totals: ActivityStats;
  /** Agents with any activity in the window. */
  activeAgents: number;
  range: ClientRange;
  since: string | null;
  until: string | null;
  generatedAt: string;
}

export interface LiveStatsDetail extends LiveStats {
  byUser: Map<string, ActivityStats>;
}

export const isActive = (s: ActivityStats) => s.leads + s.dials + s.apps + s.policies > 0;

// One shared computation per instance and range for a few seconds, so a busy
// homepage doesn't re-scan lead activity for every visitor.
const CACHE_MS = 15_000;
const cache = new Map<ClientRange, { at: number; value: Promise<LiveStatsDetail> }>();

async function compute(range: ClientRange): Promise<LiveStatsDetail> {
  const now = new Date();
  const { since, until } = rangeWindow(range, now);
  const byUser = await activityByUser(since, null, until);
  let totals = emptyStats();
  let activeAgents = 0;
  for (const s of byUser.values()) {
    totals = addStats(totals, s);
    if (isActive(s)) activeAgents++;
  }
  return {
    totals, activeAgents, byUser, range,
    since: since?.toISOString() ?? null,
    until: until?.toISOString() ?? null,
    generatedAt: now.toISOString(),
  };
}

export function liveStats(range: ClientRange = "30d"): Promise<LiveStatsDetail> {
  const hit = cache.get(range);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = compute(range);
  cache.set(range, { at: Date.now(), value });
  value.catch(() => { if (cache.get(range)?.value === value) cache.delete(range); });
  return value;
}
