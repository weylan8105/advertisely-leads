// Leads by client: how many leads each client got over any date range, by
// Central day. Same counting as Lead Pace (lib/leadPace.ts): leads by when they
// were assigned, under whoever holds them now, trashed leads left out.
//
// "Every client" = every non-admin account that is an advertiser, has placed an
// order, or has ever been assigned a lead, so clients with none in the range
// still show (at the bottom, with 0). Admins and the house account are listed
// after the clients, marked as admins.

import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ACTIVITY_TZ } from "./activityStats";
import { addDays, dayStart, ymdInTz } from "./adPerformance";
import { HOUSE_EMAIL } from "./housePause";

export const MAX_RANGE_DAYS = 800;

export type ClientDayRow = {
  userId: string;
  name: string;
  admin: boolean;
  total: number;
  /** total ÷ days in the range */
  avgPerDay: number;
  bestDay: { day: string; n: number } | null;
  daysWithLeads: number;
  /** YYYY-MM-DD → leads that day (days with none are left out) */
  byDay: Record<string, number>;
};

export type LeadsByClient = {
  from: string;
  to: string;
  days: number;
  total: number;
  clientTotal: number;
  rows: ClientDayRow[];
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: string | null | undefined): s is string {
  if (!s || !YMD.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

export async function getLeadsByClient(from: string, to: string): Promise<LeadsByClient> {
  if (!prisma) throw new Error("Database not configured");
  const start = dayStart(from, ACTIVITY_TZ);
  const end = dayStart(addDays(to, 1), ACTIVITY_TZ);

  const [counts, everAssigned, buyers, advertisers] = await Promise.all([
    prisma.$queryRaw<{ uid: string; day: string; n: number }[]>(Prisma.sql`
      SELECT "assignedUserId" AS uid,
             to_char(("assignedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${ACTIVITY_TZ}, 'YYYY-MM-DD') AS day,
             count(*)::int AS n
      FROM "Lead"
      WHERE "trashedAt" IS NULL AND "assignedUserId" IS NOT NULL
        AND "assignedAt" >= ${start} AND "assignedAt" < ${end}
      GROUP BY 1, 2`),
    prisma.lead.groupBy({ by: ["assignedUserId"], where: { assignedUserId: { not: null } } }),
    prisma.order.groupBy({ by: ["userId"] }),
    prisma.user.findMany({ where: { isAdvertiser: true }, select: { id: true } }),
  ]);

  const ids = new Set<string>([
    ...everAssigned.map((g) => g.assignedUserId as string),
    ...buyers.map((g) => g.userId),
    ...advertisers.map((a) => a.id),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true, email: true, role: true },
  });

  const byUser = new Map<string, Record<string, number>>();
  for (const c of counts) {
    const m = byUser.get(c.uid) ?? {};
    m[c.day] = (m[c.day] ?? 0) + Number(c.n);
    byUser.set(c.uid, m);
  }

  const days = daysBetween(from, to);
  const rows: ClientDayRow[] = users.map((u) => {
    const byDay = byUser.get(u.id) ?? {};
    let total = 0;
    let bestDay: ClientDayRow["bestDay"] = null;
    for (const [day, n] of Object.entries(byDay)) {
      total += n;
      if (!bestDay || n > bestDay.n || (n === bestDay.n && day > bestDay.day)) bestDay = { day, n };
    }
    return {
      userId: u.id,
      name: u.name?.trim() || (u.email ?? "").split("@")[0] || "Unnamed",
      admin: u.role === "ADMIN" || (u.email ?? "").trim().toLowerCase() === HOUSE_EMAIL,
      total,
      avgPerDay: days > 0 ? total / days : 0,
      bestDay,
      daysWithLeads: Object.keys(byDay).length,
      byDay,
    };
  });
  rows.sort((a, b) => Number(a.admin) - Number(b.admin) || b.total - a.total || a.name.localeCompare(b.name));

  const total = rows.reduce((s, r) => s + r.total, 0);
  const clientTotal = rows.filter((r) => !r.admin).reduce((s, r) => s + r.total, 0);
  return { from, to, days, total, clientTotal, rows };
}

/** Today in Central time, for defaults. */
export const todayCentral = (now = new Date()) => ymdInTz(now, ACTIVITY_TZ);
