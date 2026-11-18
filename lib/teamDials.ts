import { prisma } from "./prisma";
import { ACTIVITY_TZ, dialsByUser } from "./activityStats";

/**
 * Team dials for uplines: anyone who leads a team (the org's owner, or an
 * OWNER/ADMIN member) with at least one other member sees each member's dials.
 *
 *   today    live, from midnight Central to now
 *   report   the daily report, midnight to 9 pm Central. Before 9 pm it's
 *            yesterday's; from 9 pm on it's today's.
 *
 * Dials follow lib/dials.ts (a number copy is 2, then a 1-minute cooldown) and
 * count in the main pipeline and Goldmine alike, credited to whoever dialed.
 */

export const REPORT_HOUR = 21; // 9 pm Central

export interface MemberDials {
  userId: string;
  name: string;
  isLeader: boolean;
  today: { dials: number; leads: number };
  report: { dials: number; leads: number };
}

export interface TeamDials {
  teamId: string;
  teamName: string;
  members: MemberDials[];
}

export interface TeamDialsReport {
  now: string;
  todayStart: string;
  report: { day: string; start: string; end: string; isToday: boolean };
  teams: TeamDials[];
}

/** The windows, worked out in Postgres so daylight saving is handled. */
async function windows(): Promise<{ todayStart: Date; todayReport: Date; yStart: Date; yReport: Date; now: Date }> {
  const rows = await prisma!.$queryRaw<{ todayStart: Date; todayReport: Date; yStart: Date; yReport: Date; now: Date }[]>`
    SELECT (date_trunc('day', now() AT TIME ZONE ${ACTIVITY_TZ}) AT TIME ZONE ${ACTIVITY_TZ}) AS "todayStart",
           ((date_trunc('day', now() AT TIME ZONE ${ACTIVITY_TZ}) + make_interval(hours => ${REPORT_HOUR}::int)) AT TIME ZONE ${ACTIVITY_TZ}) AS "todayReport",
           ((date_trunc('day', now() AT TIME ZONE ${ACTIVITY_TZ}) - interval '1 day') AT TIME ZONE ${ACTIVITY_TZ}) AS "yStart",
           ((date_trunc('day', now() AT TIME ZONE ${ACTIVITY_TZ}) - interval '1 day' + make_interval(hours => ${REPORT_HOUR}::int)) AT TIME ZONE ${ACTIVITY_TZ}) AS "yReport",
           now() AS now`;
  return rows[0];
}

const dayOf = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: ACTIVITY_TZ });

/** Teams this user leads that have at least one other member. */
export async function ledTeams(userId: string) {
  if (!prisma) return [];
  const orgs = await prisma.organization.findMany({
    where: {
      OR: [{ ownerId: userId }, { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } }],
    },
    select: {
      id: true,
      name: true,
      ownerId: true,
      memberships: { select: { userId: true, user: { select: { name: true, email: true } } } },
    },
  });
  return orgs.filter((o) => o.memberships.some((m) => m.userId !== userId));
}

export async function teamDialsReport(userId: string): Promise<TeamDialsReport | null> {
  if (!prisma) return null;
  const teams = await ledTeams(userId);
  if (!teams.length) return null;

  const w = await windows();
  const reportIsToday = w.now >= w.todayReport;
  const rStart = reportIsToday ? w.todayStart : w.yStart;
  const rEnd = reportIsToday ? w.todayReport : w.yReport;

  const ids = [...new Set(teams.flatMap((t) => [t.ownerId, ...t.memberships.map((m) => m.userId)]))];
  const [today, report, owners] = await Promise.all([
    dialsByUser(w.todayStart, new Date(w.now.getTime() + 1000), ids),
    dialsByUser(rStart, rEnd, ids),
    prisma.user.findMany({ where: { id: { in: teams.map((t) => t.ownerId) } }, select: { id: true, name: true, email: true } }),
  ]);
  const zero = { dials: 0, leads: 0 };

  return {
    now: w.now.toISOString(),
    todayStart: w.todayStart.toISOString(),
    report: { day: dayOf(rStart), start: rStart.toISOString(), end: rEnd.toISOString(), isToday: reportIsToday },
    teams: teams.map((t) => {
      const people = new Map<string, string>();
      const owner = owners.find((o) => o.id === t.ownerId);
      if (owner) people.set(owner.id, owner.name?.trim() || owner.email);
      for (const m of t.memberships) people.set(m.userId, m.user.name?.trim() || m.user.email);
      const members = [...people].map(([id, name]) => ({
        userId: id,
        name,
        isLeader: id === t.ownerId,
        today: today.get(id) ?? zero,
        report: report.get(id) ?? zero,
      }));
      members.sort((a, b) => b.today.dials - a.today.dials || b.report.dials - a.report.dials || a.name.localeCompare(b.name));
      return { teamId: t.id, teamName: t.name, members };
    }),
  };
}
