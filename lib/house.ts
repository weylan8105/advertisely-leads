import { prisma } from "./prisma";
import { IUL_POOL_IDS, findPackage } from "@/data/packages";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { quotaRecipientFor } from "./teamQuota";
import { forwardLeadToRingy, isRingyConfigured, type RingyConfig } from "./ringy";
import { advertiserTeamRecipient } from "./advertiserVolume";
import { assignFundedLead, fundedTeamRecipient, teamHasFundedMembers } from "./teamAdSpend";
import { campaignCplCents } from "./adSpend";
import { ADVERTISER_NAME_KEY } from "./leadOrigin";
import { primaryOwnedTeam } from "./org";

// Ryan's house CRM only ever takes NEW/fresh leads (the Real-Time window),
// never aged inventory — so his profile doesn't fill with old leads.
const HOUSE_FRESH_DAYS = 2;

// Ryan's account is the house. Picked by email: "oldest admin" stopped meaning
// Ryan once Weylan, who signed up first, became an admin, and every house lead
// went to Weylan. HOUSE_ACCOUNT_EMAIL can point it elsewhere.
const HOUSE_EMAIL = (process.env.HOUSE_ACCOUNT_EMAIL || "ryanrush129@gmail.com").trim().toLowerCase();

/**
 * The "house" account — the platform admin's own CRM (Ryan). Any lead whose
 * state no active order covers is routed here instead of sitting unassigned in
 * the pool, so his team works it while it's fresh. Falls back to the oldest
 * admin if that account isn't an admin, and to null if no admin exists.
 */
export async function getHouseAccount(): Promise<{ userId: string; organizationId: string | null } | null> {
  if (!prisma) return null;
  const select = { id: true, ownedOrganizations: { select: { id: true }, orderBy: { createdAt: "asc" as const }, take: 1 } };
  const admin =
    (await prisma.user.findFirst({
      where: { role: "ADMIN", email: { equals: HOUSE_EMAIL, mode: "insensitive" } },
      select,
    })) ??
    (await prisma.user.findFirst({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" }, select }));
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
export async function getEligibleAdminSlots(): Promise<
  { userId: string; organizationId: string | null; licensedStates: string[] }[]
> {
  if (!prisma) return [];
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", weeklyLeadTarget: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      weeklyLeadTarget: true,
      licensedStates: true,
      ownedOrganizations: { select: { id: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (admins.length === 0) return [];
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const slots: { userId: string; organizationId: string | null; licensedStates: string[] }[] = [];
  for (const a of admins) {
    const orgId = a.ownedOrganizations[0]?.id;
    const got = await prisma.lead.count({
      where: {
        orderId: null,
        trashedAt: null,
        assignedAt: { gte: weekAgo },
        // Overflow their team's weekly amounts handed to downline agents still
        // counts toward the admin's own target.
        OR: [
          { assignedUserId: a.id },
          ...(orgId ? [{ organizationId: orgId, quotaRoutedAt: { not: null } }] : []),
        ],
      },
    });
    if (got < (a.weeklyLeadTarget ?? 0)) {
      slots.push({
        userId: a.id,
        organizationId: a.ownedOrganizations[0]?.id ?? null,
        licensedStates: a.licensedStates ?? [],
      });
    }
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
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { receivedAt: true, state: true } });
  if (!lead) return false;
  // Overflow is fresh-only (never aged) — an aged lead stays in the bank as stock.
  if ((Date.now() - lead.receivedAt.getTime()) / 86_400_000 > HOUSE_FRESH_DAYS) return false;
  // If the admin's team hands out leads by weekly amounts, an agent with room gets it.
  const agentId = await quotaRecipientFor(organizationId, userId, lead.state);
  const recipientId = agentId ?? userId;
  const now = new Date();
  const res = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: recipientId,
      assignedAt: now,
      ...(organizationId ? { organizationId } : {}),
      ...(agentId ? { quotaRoutedAt: now } : {}),
    },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: {
      leadId,
      type: "LEAD_ASSIGNED",
      body: agentId
        ? `Routed to a team member by weekly amounts — ${reason}.`
        : `Routed to admin CRM — ${reason}.`,
    },
  });
  // Email whoever got it (the admin, or their agent) the same lead-delivery
  // email clients get, so round-robin leads don't land silently. Never block routing on an email failure.
  if (isEmailConfigured) {
    try {
      const [full, recipient] = await Promise.all([
        prisma.lead.findUnique({
          where: { id: leadId },
          select: { name: true, phone: true, email: true, state: true, occupation: true, age: true, income: true, intentReason: true, packageId: true },
        }),
        prisma.user.findUnique({ where: { id: recipientId }, select: { email: true, name: true } }),
      ]);
      if (full && recipient?.email) {
        await sendLeadDeliveryEmail({
          agentEmail: recipient.email,
          agentName: recipient.name ?? "there",
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
 * Direct-to-advertiser delivery. An advertiser (a client running their own Meta
 * campaign through Advertisely) owns every lead their form produces — those leads
 * go straight into THAT user's CRM and are never offered to the marketplace or any
 * buyer order. Keyed off MetaFormMapping.ownerUserId at ingest, this is the
 * form-scoped sibling of assignLeadToHouse: assign to one owner, log, notify.
 * No age gate — the advertiser owns the lead regardless of its age. Guarded on
 * assignedUserId:null so it never collides with anything else.
 */
export async function deliverLeadToOwner(
  leadId: string,
  ownerUserId: string,
  reason: string,
): Promise<boolean> {
  if (!prisma) return false;
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: {
      email: true,
      name: true,
      defaultOrganizationId: true,
      ownedOrganizations: { select: { id: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!owner) return false;
  const organizationId =
    primaryOwnedTeam(owner.ownedOrganizations, owner.defaultOrganizationId)?.id ?? owner.defaultOrganizationId ?? null;

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { state: true, rawFormData: true } });

  const label = owner.name?.trim() || owner.email;
  const now = new Date();
  // Stamp the client's name so the lead card reads "<Client> Lead", not one of
  // our own funnels — even when a teammate receives it.
  const raw = lead?.rawFormData && typeof lead.rawFormData === "object" && !Array.isArray(lead.rawFormData)
    ? lead.rawFormData
    : {};
  const leadData = {
    assignedAt: now,
    rawFormData: { ...raw, [ADVERTISER_NAME_KEY]: label },
    ...(organizationId ? { organizationId } : {}),
  };

  // Downlines who added spend to this campaign take turns in a rotation with
  // the advertiser, paying the campaign's cost per lead (lib/teamAdSpend.ts).
  let funded: { userId: string; cplCents: number } | null = null;
  try {
    if (organizationId && (await teamHasFundedMembers(ownerUserId, organizationId))) {
      const cplCents = await campaignCplCents(ownerUserId);
      const pick = cplCents
        ? await fundedTeamRecipient(ownerUserId, organizationId, lead?.state ?? "", cplCents, label)
        : null;
      if (pick && cplCents && (await assignFundedLead({ leadId, advertiserId: ownerUserId, userId: pick, cplCents, leadData }))) {
        funded = { userId: pick, cplCents };
      }
    }
  } catch (e) {
    console.warn("[house] team ad spend routing failed", e);
  }

  // The advertiser's turn: past their weekly keep amount, or by turn on a
  // round-robin team (lib/advertiserVolume.ts), the lead goes to someone on the
  // advertiser's team instead; otherwise they keep it.
  const teamPick = funded ? null : await advertiserTeamRecipient(ownerUserId, organizationId, lead?.state ?? "");
  const recipientId = funded?.userId ?? teamPick?.userId ?? ownerUserId;

  if (!funded) {
    const res = await prisma.lead.updateMany({
      where: { id: leadId, assignedUserId: null, trashedAt: null },
      data: {
        ...leadData,
        assignedUserId: recipientId,
        ...(teamPick?.byQuota ? { quotaRoutedAt: now } : {}),
      },
    });
    if (res.count === 0) return false;
  }

  const routedToTeam = !!(funded || teamPick);
  const recipient = routedToTeam
    ? await prisma.user.findUnique({ where: { id: recipientId }, select: { email: true, name: true } })
    : null;
  const who = recipient?.name ?? recipient?.email ?? "a team member";
  await prisma.leadActivity.create({
    data: {
      leadId,
      type: "LEAD_ASSIGNED",
      body: funded
        ? `${reason} Routed to ${who}, who added spend to the advertiser's campaign (${(funded.cplCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} cost per lead taken from their credit).`
        : teamPick
          ? `${reason} Routed to ${who} on the advertiser's team (${teamPick.byRotation ? "round-robin" : "past the advertiser's weekly keep amount"}).`
          : reason,
    },
  });

  // Mark the account as an advertiser the first time one of their exclusive leads
  // lands, so the admin Client-accounts tab segments them without manual setup.
  await prisma.user.updateMany({
    where: { id: ownerUserId, isAdvertiser: false },
    data: { isAdvertiser: true },
  });

  // Forward to the advertiser's own CRM (Ringy) when they've connected one, so
  // their exclusive leads flow straight into their dialer in addition to their
  // Advertisely CRM. Keyed off a per-user RINGY Integration; never block delivery
  // on a forward failure — log the outcome either way.
  try {
    // Only leads the advertiser keeps go to their own dialer.
    const ringy = routedToTeam ? null : await prisma.integration.findUnique({
      where: { userId_type: { userId: ownerUserId, type: "RINGY" } },
      select: { enabled: true, config: true, id: true },
    });
    const cfg = ringy?.config as Partial<RingyConfig> | undefined;
    if (ringy?.enabled && isRingyConfigured(cfg)) {
      const full = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { name: true, phone: true, email: true, state: true, age: true, occupation: true, income: true },
      });
      if (full) {
        const result = await forwardLeadToRingy(full, cfg);
        await prisma.leadActivity.create({
          data: {
            leadId,
            type: "LEAD_RECEIVED",
            body: result.ok
              ? `Forwarded to advertiser's Ringy CRM${result.vendorResponseId ? ` (ref ${result.vendorResponseId})` : ""}.`
              : `Ringy forward failed — ${result.error ?? "unknown error"}.`,
          },
        });
        await prisma.integration.update({ where: { id: ringy.id }, data: { lastUsedAt: new Date() } });
      }
    }
  } catch (e) {
    console.warn("Ringy forward failed:", e);
  }

  // Notify the advertiser with the same delivery email buyers get, so their own
  // leads don't land silently. Never block delivery on an email failure.
  const notify = routedToTeam ? recipient : owner;
  if (isEmailConfigured && notify?.email) {
    try {
      const full = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
          name: true, phone: true, email: true, state: true,
          occupation: true, age: true, income: true, intentReason: true, packageId: true,
        },
      });
      if (full) {
        await sendLeadDeliveryEmail({
          agentEmail: notify.email,
          agentName: notify.name ?? "there",
          leadCount: 1,
          packageName: findPackage(full.packageId)?.name ?? (routedToTeam ? "Your team's campaign" : "Your campaign"),
          orderId: leadId,
          leads: [{
            name: full.name, phone: full.phone, email: full.email, state: full.state,
            occupation: full.occupation, age: full.age, income: full.income, intentReason: full.intentReason,
          }],
        });
      }
    } catch (e) {
      console.warn("Advertiser lead email failed:", e);
    }
  }
  return true;
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
