import { prisma } from "./prisma";
import { DEFAULT_STAGE } from "@/data/pipeline";

/**
 * Per-client pipeline-activity reporting — the data behind the weekly
 * "who isn't working their leads" admin alert (see
 * app/api/cron/stalled-leads/route.ts) and ad-hoc activity audits.
 *
 * "Worked" = a lead has been moved off the intake stage (`new-lead`) into any
 * later CRM stage. A client sitting on a pile of untouched `new-lead` leads is
 * not dialing — the churn/refund risk we want surfaced early.
 */

// A client is flagged when ANY of these is true (tune here, single source):
export const STALLED_MIN_UNTOUCHED = 10; // ≥ this many leads stuck in `new-lead`
export const STALLED_QUIET_DAYS = 7; //    no stage move in ≥ this many days (with untouched leads)

export interface ClientActivity {
  userId: string;
  email: string;
  name: string;
  total: number;
  untouched: number; // leads still in `new-lead`
  worked: number; //    leads moved off `new-lead`
  workedPct: number; // 0–100
  converted: number; // approved + issued-not-paid + issued-paid
  lastMoveMs: number | null; // latest updatedAt among worked leads (approx "last stage move")
  quietDays: number | null; // days since lastMove, null if never moved
  stages: Record<string, number>;
  flagged: boolean;
  reasons: string[]; // human-readable why-flagged
}

const CONVERSION_STAGES = new Set(["approved", "issued-not-paid", "issued-paid"]);

function parseExcludedEmails(): Set<string> {
  return new Set(
    (process.env.ACTIVITY_EXCLUDE_EMAILS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Build the per-client activity report across all client pipelines.
 * Excludes the house/admin account(s) and trashed leads. Optionally drops
 * accounts listed in ACTIVITY_EXCLUDE_EMAILS (e.g. internal/test buyers).
 */
export async function buildClientActivityReport(): Promise<{
  clients: ClientActivity[];
  flagged: ClientActivity[];
  totals: { clients: number; leads: number; worked: number; converted: number; untouched: number };
}> {
  const empty = {
    clients: [],
    flagged: [],
    totals: { clients: 0, leads: 0, worked: 0, converted: 0, untouched: 0 },
  };
  if (!prisma) return empty;

  // House = all admins (resolved by role, mirrors lib/house.ts). Their own CRM
  // isn't a "client pipeline", so exclude every admin, not just the canonical one.
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
  const adminIds = new Set(admins.map((a) => a.id));
  const excludedEmails = parseExcludedEmails();

  const leads = await prisma.lead.findMany({
    where: { assignedUserId: { not: null }, trashedAt: null },
    select: { assignedUserId: true, pipelineStage: true, updatedAt: true },
  });

  const userIds = Array.from(new Set(leads.map((l) => l.assignedUserId!).filter((id) => !adminIds.has(id))));
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, name: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const now = Date.now();
  const acc = new Map<string, ClientActivity>();

  for (const l of leads) {
    const uid = l.assignedUserId!;
    if (adminIds.has(uid)) continue;
    const u = userById.get(uid);
    if (!u?.email) continue;
    if (excludedEmails.has(u.email.toLowerCase())) continue;

    let row = acc.get(uid);
    if (!row) {
      row = {
        userId: uid,
        email: u.email,
        name: u.name ?? "",
        total: 0,
        untouched: 0,
        worked: 0,
        workedPct: 0,
        converted: 0,
        lastMoveMs: null,
        quietDays: null,
        stages: {},
        flagged: false,
        reasons: [],
      };
      acc.set(uid, row);
    }

    const stage = l.pipelineStage || DEFAULT_STAGE;
    row.total++;
    row.stages[stage] = (row.stages[stage] ?? 0) + 1;
    if (stage === DEFAULT_STAGE) {
      row.untouched++;
    } else {
      row.worked++;
      const t = l.updatedAt ? new Date(l.updatedAt).getTime() : 0;
      if (t && (row.lastMoveMs === null || t > row.lastMoveMs)) row.lastMoveMs = t;
    }
    if (CONVERSION_STAGES.has(stage)) row.converted++;
  }

  const clients = Array.from(acc.values());
  for (const c of clients) {
    c.workedPct = c.total ? Math.round((c.worked / c.total) * 100) : 0;
    c.quietDays = c.lastMoveMs === null ? null : Math.floor((now - c.lastMoveMs) / 86400000);

    if (c.worked === 0 && c.total > 0) {
      c.flagged = true;
      c.reasons.push(`Never worked a lead — all ${c.total} sitting in New Lead`);
    } else {
      if (c.untouched >= STALLED_MIN_UNTOUCHED) {
        c.flagged = true;
        c.reasons.push(`${c.untouched} leads stuck in New Lead`);
      }
      if (c.quietDays !== null && c.quietDays >= STALLED_QUIET_DAYS && c.untouched > 0) {
        c.flagged = true;
        c.reasons.push(`No stage move in ${c.quietDays} days, ${c.untouched} still untouched`);
      }
    }
  }

  // Worst offenders first: never-worked, then most untouched leads.
  clients.sort((a, b) => Number(b.worked === 0) - Number(a.worked === 0) || b.untouched - a.untouched);

  const totals = clients.reduce(
    (t, c) => {
      t.leads += c.total;
      t.worked += c.worked;
      t.converted += c.converted;
      t.untouched += c.untouched;
      return t;
    },
    { clients: clients.length, leads: 0, worked: 0, converted: 0, untouched: 0 },
  );

  return { clients, flagged: clients.filter((c) => c.flagged), totals };
}
