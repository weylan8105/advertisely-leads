// Rolling 30-day production totals across every agent on Advertisely: the live
// stats strip on the public homepage (app/api/stats/live) and the admin console's
// "Live 30-day stats" tab (app/api/admin/live-stats). Same numbers as the
// leaderboard (lib/activityStats.ts), just summed over the trailing 30 days.

import { activityByUser, addStats, emptyStats, type ActivityStats } from "./activityStats";

export const LIVE_STATS_DAYS = 30;

export interface LiveStats {
  totals: ActivityStats;
  /** Agents with any activity in the window. */
  activeAgents: number;
  since: string;
  generatedAt: string;
}

export interface LiveStatsDetail extends LiveStats {
  byUser: Map<string, ActivityStats>;
}

// One shared computation per instance for a few seconds, so a busy homepage
// doesn't re-scan 30 days of lead activity for every visitor.
const CACHE_MS = 15_000;
let cached: { at: number; value: Promise<LiveStatsDetail> } | null = null;

async function compute(): Promise<LiveStatsDetail> {
  const now = new Date();
  const since = new Date(now.getTime() - LIVE_STATS_DAYS * 86_400_000);
  const byUser = await activityByUser(since);
  let totals = emptyStats();
  let activeAgents = 0;
  for (const s of byUser.values()) {
    totals = addStats(totals, s);
    if (s.leads + s.dials + s.apps + s.policies > 0) activeAgents++;
  }
  return { totals, activeAgents, byUser, since: since.toISOString(), generatedAt: now.toISOString() };
}

export function liveStats(): Promise<LiveStatsDetail> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  const value = compute();
  cached = { at: Date.now(), value };
  value.catch(() => { if (cached?.value === value) cached = null; });
  return value;
}
