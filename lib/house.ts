import { prisma } from "./prisma";
import { IUL_POOL_IDS, findPackage } from "@/data/packages";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";

// Ryan's house CRM only ever takes NEW/fresh leads (the Real-Time window),
// never aged inventory — so his profile doesn't fill with old leads.
const HOUSE_FRESH_DAYS = 2;

/**
 * The "house" account — the platform admin's own CRM (Ryan). Any lead whose
 * state no active order covers is routed here instead of sitting unassigned in
 * the pool, so his team works it while it's fresh. Resolved by role rather than
 * a hard-coded email; falls back to null if no admin exists.
 */
export async function getHouseAccount(): Promise<{ userId: string; organizationId: string | null } | null> {
  if (!prisma) return null;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true, ownedOrganizations: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!admin) return null;
  return { userId: admin.id, organizationId: admin.ownedOrganizations[0]?.id ?? null };
}

/**
 * Admins eligible to absorb OVERFLOW this cycle (owner directive, Oct 2026):
 * role ADMIN, with a weekly target set, and still UNDER their rolling-7-day
 * overflow count. Each becomes a round-robin slot; once an admin hits their
 * target they drop out (and overflow stays in the bank). Ordered by createdAt
 * so the rotation is stable.
 */
export async function getEligibleAdminSlots(): Promise<{ userId: string; organizationId: string | null }[]> {
  if (!prisma) return [];
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", weeklyLeadTarget: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      weeklyLeadTarget: true,
      ownedOrganizations: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (admins.length === 0) return [];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const slots: { userId: string; organizationId: string | null }[] = [];
  for (const a of admins) {
    const got = await prisma.lead.count({
      where: { assignedUserId: a.id, orderId: null, trashedAt: null, assignedAt: { gte: weekAgo } },
    });
    if (got < (a.weeklyLeadTarget ?? 0)) slots.push({ userId: a.id, organizationId: a.ownedOrganizations[0]?.id ?? null });
  }
  return slots;
}

/** Assign one FRESH overflow lead to a specific admin (round-robin overflow slot). */
export async function assignOverflowLeadTo(
  leadId: string,
  userId: string,
  organizationId: string | null,
  reason: string,
): Promise<boolean> {
  if (!prisma) return false;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { receivedAt: true } });
  if (!lead) return false;
  // Overflow is fresh-only (never aged) — an aged lead stays in the bank as stock.
  if ((Date.now() - lead.receivedAt.getTime()) / 86_400_000 > HOUSE_FRESH_DAYS) return false;
  const res = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: null, trashedAt: null },
    data: { assignedUserId: userId, assignedAt: new Date(), ...(organizationId ? { organizationId } : {}) },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: { leadId, type: "LEAD_ASSIGNED", body: `Routed to admin CRM — ${reason}.` },
  });
  // Email the admin the same lead-delivery email clients get, so round-robin
  // leads don't land silently. Never block routing on an email failure.
  if (isEmailConfigured) {
    try {
      const [full, admin] = await Promise.all([
        prisma.lead.findUnique({
          where: { id: leadId },
          select: { name: true, phone: true, email: true, state: true, occupation: true, age: true, income: true, intentReason: true, packageId: true },
        }),
        prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      ]);
      if (full && admin?.email) {
        await sendLeadDeliveryEmail({
          agentEmail: admin.email,
          agentName: admin.name ?? "there",
          leadCount: 1,
          packageName: findPackage(full.packageId)?.name ?? "IUL",
          orderId: leadId,
          leads: [{
            name: full.name, phone: full.phone, email: full.email, state: full.state,
            occupation: full.occupation, age: full.age, income: full.income, intentReason: full.intentReason,
          }],
        });
      }
    } catch (e) {
      console.warn("Overflow lead email failed:", e);
    }
  }
  return true;
}

/**
 * The set of states an incoming lead could still be delivered into — i.e. the
 * union of filterStates across all OPEN orders (an empty filterStates = all
 * states, so such an order makes every state "covered"). A lead whose state is
 * not in this set has no buyer and belongs to the house.
 */
export async function coveredStates(): Promise<{ states: Set<string>; anyStateOrder: boolean }> {
  if (!prisma) return { states: new Set(), anyStateOrder: false };
  // Only orders that can actually absorb a FRESH lead count as coverage — i.e.
  // orders whose age window starts at 0 (Real-Time). An aged-tier order (e.g.
  // 30–44 days) lists its states but can't take a brand-new lead, so those
  // states stay "uncovered" for fresh routing and flow to the house.
  const open = await prisma.order.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING", "DELIVERING"] },
      OR: [{ filterAgeMinDays: null }, { filterAgeMinDays: 0 }],
    },
    select: { filterStates: true },
  });
  const states = new Set<string>();
  let anyStateOrder = false;
  for (const o of open) {
    if (o.filterStates.length === 0) anyStateOrder = true;
    o.filterStates.forEach((s) => states.add(s));
  }
  return { states, anyStateOrder };
}

/**
 * Assign one lead to the house CRM (unassigned/orphaned → Ryan). No delivery
 * email — this is an internal hand-off, not a client fulfillment. Guarded on
 * assignedUserId:null so it never steals a lead an order just claimed.
 */
export async function assignLeadToHouse(leadId: string, reason: string): Promise<boolean> {
  if (!prisma) return false;
  const house = await getHouseAccount();
  if (!house) return false;
  // House takes fresh leads only — never aged. Skip anything past the window.
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { receivedAt: true } });
  if (!lead) return false;
  if ((Date.now() - lead.receivedAt.getTime()) / 86_400_000 > HOUSE_FRESH_DAYS) return false;
  const now = new Date();
  const res = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: house.userId,
      assignedAt: now,
      ...(house.organizationId ? { organizationId: house.organizationId } : {}),
    },
  });
  if (res.count > 0) {
    await prisma.leadActivity.create({
      data: { leadId, type: "LEAD_ASSIGNED", body: `Routed to house CRM — ${reason}.` },
    });
    return true;
  }
  return false;
}

/**
 * Backfill: sweep every unassigned pool lead whose state no open order covers
 * into the house CRM. Leaves states with active demand alone (their inventory
 * still serves those orders + the aged store). Returns what moved.
 */
export async function sweepOrphansToHouse(): Promise<{
  moved: number;
  byState: Record<string, number>;
  skippedCoveredStates: string[];
}> {
  if (!prisma) return { moved: 0, byState: {}, skippedCoveredStates: [] };
  const house = await getHouseAccount();
  if (!house) return { moved: 0, byState: {}, skippedCoveredStates: [] };

  const { states: covered, anyStateOrder } = await coveredStates();
  // An open "all states" order means nothing is orphaned.
  if (anyStateOrder) return { moved: 0, byState: {}, skippedCoveredStates: [...covered] };

  // Fresh-only: never sweep aged inventory into the house CRM.
  const cutoff = new Date(Date.now() - HOUSE_FRESH_DAYS * 86_400_000);
  const pool = await prisma.lead.findMany({
    where: {
      packageId: { in: IUL_POOL_IDS },
      assignedUserId: null,
      orderId: null,
      trashedAt: null,
      receivedAt: { gte: cutoff },
    },
    select: { id: true, state: true },
  });

  const orphans = pool.filter((l) => l.state && !covered.has(l.state));
  const now = new Date();
  const byState: Record<string, number> = {};

  // Move in one updateMany per state batch for efficiency, then log activity.
  const ids = orphans.map((l) => l.id);
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await prisma.lead.updateMany({
      where: { id: { in: chunk }, assignedUserId: null },
      data: {
        assignedUserId: house.userId,
        assignedAt: now,
        ...(house.organizationId ? { organizationId: house.organizationId } : {}),
      },
    });
    await prisma.leadActivity.createMany({
      data: chunk.map((leadId) => ({
        leadId,
        type: "LEAD_ASSIGNED" as const,
        body: "Routed to house CRM — no active order covers this state.",
      })),
    });
  }
  for (const l of orphans) byState[l.state] = (byState[l.state] ?? 0) + 1;

  return { moved: orphans.length, byState, skippedCoveredStates: [...covered].sort() };
}
