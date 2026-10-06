import { prisma } from "./prisma";
import { ensureOrgContext } from "./org";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { appendRows, isSheetsConfigured } from "./sheets";
import { buildExportRows } from "./leadExport";
import { findPackage, leadPoolIdsFor, purchasableIdsForPool } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";
import { assignLeadToHouse, getHouseAccount } from "@/lib/house";
import { tryReplacementForFreshLead } from "@/lib/replacement";
import { HOLDBACK_TAGS_TO_HOUSE } from "@/lib/flags";

/**
 * Attempt to fulfill one order by finding unassigned leads matching its filters.
 * Returns the number of leads newly assigned.
 *
 * This runs in two scenarios:
 *  1. Immediately after an order is placed (catch existing inventory).
 *  2. After each Meta webhook insert (assign fresh leads to pending orders).
 */
export async function fulfillOrder(orderId: string, opts: { onlyLeadId?: string } = {}): Promise<number> {
  if (!prisma) return 0;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { leads: { where: { trashedAt: null }, select: { id: true } } },
  });
  if (!order) return 0;
  if (order.status === "DELIVERED" || order.status === "REFUNDED") return 0;

  // Remaining is based on the LIVE count of non-trashed leads actually on the
  // order — not the stored fulfilledCount — so delivery self-heals from any
  // drift (e.g. a lead removed/trashed after the counter was set).
  const liveDelivered = order.leads.length;
  const remaining = order.quantity - liveDelivered;
  if (remaining <= 0) return 0;

  // State is REQUIRED. An order with no states configured must NEVER vacuum up
  // every state — a client only ever receives leads in states they ordered.
  // Deliver nothing until the order has states set (misconfiguration guard).
  if (order.filterStates.length === 0) return 0;

  // Aged buckets carry an age window (days) relative to receivedAt. Translate
  // it into a receivedAt range; null bounds are left open.
  const dayMs = 86_400_000;
  const nowMs = Date.now();
  // ageMaxDays is the exclusive upper edge (shared with the next bucket's
  // ageMinDays) → gt, so adjacent buckets tile with no gap or overlap.
  // Age bounds come from the order; if an order was never stamped, fall back to
  // the package's own age window so a tiered product (e.g. Real-Time = 0–2 days)
  // can NEVER deliver out-of-window leads even on an unstamped order.
  const pkgForAge = findPackage(order.packageId);
  const ageMaxDays = order.filterAgeMaxDays ?? pkgForAge?.ageMaxDays ?? null;
  const ageMinDays = order.filterAgeMinDays ?? pkgForAge?.ageMinDays ?? null;
  const receivedAtFilter: { gt?: Date; lte?: Date } = {};
  if (ageMaxDays != null) receivedAtFilter.gt = new Date(nowMs - ageMaxDays * dayMs);
  if (ageMinDays != null) receivedAtFilter.lte = new Date(nowMs - ageMinDays * dayMs);

  // Find unassigned leads from this order's underlying lead pool, matching its
  // state + income + age filters. Buckets resolve to their pool (e.g. aged-iul).
  const candidates = await prisma.lead.findMany({
    where: {
      packageId: { in: leadPoolIdsFor(order.packageId) },
      assignedUserId: null,
      orderId: null,
      trashedAt: null, // never deliver trashed (replaced/bad) leads
      // Hard state match — an order only ever draws leads in its own states
      // (guaranteed non-empty by the guard above).
      state: { in: order.filterStates },
      ...(order.filterIncomeMin
        ? { income: { gte: order.filterIncomeMin } }
        : {}),
      ...(receivedAtFilter.gt || receivedAtFilter.lte ? { receivedAt: receivedAtFilter } : {}),
      // Never deliver obviously-fake / internal test leads to a buyer.
      ...NOT_TEST_LEAD,
      // Round-robin intake pins a single lead so exactly that one is assigned.
      ...(opts.onlyLeadId ? { id: opts.onlyLeadId } : {}),
    },
    orderBy: { receivedAt: "asc" },
    take: opts.onlyLeadId ? 1 : remaining,
  });

  if (candidates.length === 0) return 0;

  // ── Distribution (Phase 1) ─────────────────────────────────────────
  // Decide who each lead goes to. MANUAL (default) → the buyer/owner, exactly
  // as before. ROUND_ROBIN → spread evenly across the org's in-rotation members
  // using a persisted cursor so the rotation stays fair across separate runs.
  let orgId = order.organizationId as string | null;
  // Orders created before Phase 1 (or before stamping) may have no org — resolve
  // and persist the buyer's org so distribution + scoping work.
  if (!orgId) {
    const ctx = await ensureOrgContext(order.userId);
    orgId = ctx?.organizationId ?? null;
    if (orgId) {
      await prisma.order.update({ where: { id: order.id }, data: { organizationId: orgId } });
    }
  }
  let mode: "MANUAL" | "ROUND_ROBIN" = "MANUAL";
  let rotation: string[] = [];
  let rrCursor = 0;
  let orgOwnerId: string | null = null;
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        ownerId: true,
        distributionMode: true,
        rrCursor: true,
        memberships: {
          where: { inRotation: true },
          select: { userId: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (org) {
      orgOwnerId = org.ownerId;
      mode = org.distributionMode;
      rrCursor = org.rrCursor;
      rotation = org.memberships.map((m) => m.userId);
    }
  }
  // Round-robin distributes the ORG OWNER's purchases across the team. A member
  // who buys their own leads (they belong to a team but aren't the owner) must
  // receive their entire order — never have it split to the agency. Without this
  // guard, an agent's personal order was round-robined to the team owner (Luke's
  // paid leads were leaking to Wylie).
  // An order routed to a specific downline agent (deliverToUserId) always goes
  // entirely to that agent — never round-robined or split.
  const routedTo = order.deliverToUserId ?? null;
  const useRR =
    !routedTo && mode === "ROUND_ROBIN" && rotation.length > 0 && order.userId === orgOwnerId;

  // leadId → assigned userId. Default recipient is the routed agent, else the buyer.
  const defaultRecipient = routedTo ?? order.userId;
  const assigneeOf = new Map<string, string>();
  candidates.forEach((l, i) => {
    assigneeOf.set(l.id, useRR ? rotation[(rrCursor + i) % rotation.length] : defaultRecipient);
  });
  // Group ids by assignee for batched updates.
  const idsByAssignee = new Map<string, string[]>();
  for (const [leadId, assignee] of assigneeOf) {
    const arr = idsByAssignee.get(assignee) ?? [];
    arr.push(leadId);
    idsByAssignee.set(assignee, arr);
  }

  const now = new Date();
  // Assign in a single transaction so concurrent fulfillment doesn't double-assign
  await prisma.$transaction(async (tx) => {
    for (const [assignee, ids] of idsByAssignee) {
      await tx.lead.updateMany({
        where: { id: { in: ids }, assignedUserId: null },
        data: {
          assignedUserId: assignee,
          assignedAt: now,
          orderId: order.id,
          ...(orgId ? { organizationId: orgId } : {}),
        },
      });
    }

    // Advance the round-robin cursor so the next batch continues the rotation.
    if (useRR && orgId) {
      await tx.organization.update({
        where: { id: orgId },
        data: { rrCursor: (rrCursor + candidates.length) % rotation.length },
      });
    }

    // Re-sync the stored counter to the live count + what we just delivered.
    const newFulfilled = liveDelivered + candidates.length;
    await tx.order.update({
      where: { id: order.id },
      data: {
        fulfilledCount: newFulfilled,
        status:
          newFulfilled >= order.quantity
            ? "DELIVERED"
            : newFulfilled > 0
              ? "DELIVERING"
              : order.status,
        fulfilledAt: newFulfilled >= order.quantity ? new Date() : null,
      },
    });

    // Log activity on each assigned lead
    await tx.leadActivity.createMany({
      data: candidates.map((l) => ({
        leadId: l.id,
        type: "LEAD_ASSIGNED" as const,
        body: useRR
          ? `Lead routed to a team member via round-robin (order ${order.id}).`
          : `Lead assigned to customer via order ${order.id}.`,
      })),
    });
  });

  // Email EACH recipient exactly the leads that went to THEM — so every
  // notification matches what's actually in that person's CRM (never a
  // teammate's leads, and the routed agent — not the buyer — is the one told).
  if (candidates.length > 0 && isEmailConfigured) {
    try {
      const byRecipient = new Map<string, typeof candidates>();
      for (const l of candidates) {
        const who = assigneeOf.get(l.id) ?? defaultRecipient;
        const arr = byRecipient.get(who) ?? [];
        arr.push(l);
        byRecipient.set(who, arr);
      }
      const pkgName = findPackage(order.packageId)?.name ?? order.packageId;
      for (const [recipientId, theirLeads] of byRecipient) {
        const user = await prisma!.user.findUnique({
          where: { id: recipientId },
          select: { email: true, name: true },
        });
        if (!user?.email) continue;
        await sendLeadDeliveryEmail({
          agentEmail: user.email,
          agentName: user.name ?? "Agent",
          leadCount: theirLeads.length,
          packageName: pkgName,
          orderId: order.id,
          leads: theirLeads.map((l) => ({
            name: l.name,
            phone: l.phone,
            email: l.email,
            state: l.state,
            occupation: l.occupation,
            age: l.age,
            income: l.income,
            intentReason: l.intentReason,
          })),
        });
      }
    } catch (emailErr) {
      // Never block fulfillment on email failure
      console.warn("Email notification failed:", emailErr);
    }
  }

  // Live-sync the newly delivered leads into a Google Sheet. By default this is
  // the customer's connected sheet (all their orders flow there automatically);
  // if this specific order has a per-order sheet override, that wins. Rows use
  // the same columns as CSV export.
  if (candidates.length > 0 && isSheetsConfigured && prisma) {
    try {
      let targetSheetId: string | undefined =
        (order as { sheetOverrideId?: string | null }).sheetOverrideId ?? undefined;
      let integrationId: string | undefined;
      let sheetName = "Sheet1";

      if (!targetSheetId) {
        const integration = await prisma.integration.findUnique({
          where: { userId_type: { userId: order.userId, type: "GOOGLE_SHEETS" } },
        });
        if (integration?.enabled) {
          targetSheetId = (integration.config as any)?.spreadsheetId;
          sheetName = (integration.config as any)?.sheetName ?? "Sheet1";
          integrationId = integration.id;
        }
      }

      if (targetSheetId) {
        const result = await appendRows(
          targetSheetId,
          buildExportRows(candidates),
          sheetName,
        );
        await prisma.exportLog.create({
          data: {
            userId: order.userId,
            destination: "sheets",
            status: result.ok ? "SUCCESS" : "FAILED",
            responseCode: result.status || null,
            errorMessage: result.ok ? null : result.error?.slice(0, 500),
          },
        });
        if (integrationId) {
          await prisma.integration.update({
            where: { id: integrationId },
            data: { lastUsedAt: new Date() },
          });
        }
      }
    } catch (sheetsErr) {
      // Never block fulfillment on a Sheets failure
      console.warn("Google Sheets sync failed:", sheetsErr);
    }
  }

  return candidates.length;
}

/**
 * Triggered after a new lead is inserted. Walks all pending orders that could
 * potentially absorb this lead and tries to fulfill them. Order of operations
 * matters: FIFO by order createdAt.
 */
/**
 * Is this lead within an order's age window? (State is matched by the caller's
 * query.) Falls back to the package's window when the order has no explicit one,
 * mirroring fulfillOrder's own age bounds.
 */
function leadAgeEligibleForOrder(
  order: { packageId: string; filterAgeMinDays: number | null; filterAgeMaxDays: number | null },
  receivedAt: Date,
): boolean {
  const pkg = findPackage(order.packageId);
  const minD = order.filterAgeMinDays ?? pkg?.ageMinDays ?? 0;
  const maxD = order.filterAgeMaxDays ?? pkg?.ageMaxDays ?? null;
  const ageDays = (Date.now() - receivedAt.getTime()) / 86_400_000;
  if (ageDays < minD) return false;
  if (maxD != null && ageDays > maxD) return false;
  return true;
}

/**
 * TEMPORARY testing hold-back (lib/flags.ts HOLDBACK_TAGS_TO_HOUSE). A lead whose
 * tags match a held-back product goes 100% to the house (Ryan) — bypassing all
 * buyer distribution — so its quality can be evaluated before it's sold. Routes
 * regardless of age (these are new test leads) and returns true if it claimed
 * the lead. Clearing the flag array turns this off and resumes distribution.
 */
async function routeHeldBackTagToHouse(lead: { id: string; tags: string[] }): Promise<boolean> {
  if (!prisma || HOLDBACK_TAGS_TO_HOUSE.length === 0) return false;
  const tags = (lead.tags ?? []).map((t) => t.toLowerCase());
  const matched = HOLDBACK_TAGS_TO_HOUSE.find((h) => tags.some((t) => t.includes(h.toLowerCase())));
  if (!matched) return false;
  const house = await getHouseAccount();
  if (!house) return false;
  const res = await prisma.lead.updateMany({
    where: { id: lead.id, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: house.userId,
      assignedAt: new Date(),
      ...(house.organizationId ? { organizationId: house.organizationId } : {}),
    },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: "LEAD_ASSIGNED",
      body: `Held to house for testing (tag "${matched}") — not distributed to buyers.`,
    },
  });
  return true;
}

// How many states the house (Ryan) effectively covers. The house is the
// catch-all for every state, so it has the broadest coverage and therefore the
// weakest per-state claim. Used as the denominator in coverage weighting.
// Tunable: a LARGER value makes the house back off harder from buyers' states
// (buyers keep more of their turf); a smaller value lets the house compete more.
export const HOUSE_COVERAGE_STATES = 50;

/**
 * Coverage-weighted winner for a single lead among the parties competing for its
 * state. The fairness principle: a party that covers FEWER states should get a
 * LARGER share of each of those states — otherwise a narrow buyer is squeezed
 * twice (fewer states AND those few states split away), while a broad party
 * (many states, or the all-states house) accumulates by default.
 *
 * Each party's weight = 1 / (states it covers); its target share of this state =
 * weight / Σweights. The winner is the party currently furthest BELOW its target
 * (largest-remainder), so repeated calls converge to the weighted shares. Broad
 * parties still win on TOTAL volume (they're in many states) but stop dominating
 * a narrow buyer's home turf. Pure function so the projection tool and
 * production share identical math.
 */
export function coverageWeightedWinner(
  parties: { coverage: number; count: number }[],
): number {
  const weights = parties.map((p) => 1 / Math.max(1, p.coverage));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const total = parties.reduce((a, p) => a + p.count, 0);
  let best = 0;
  let bestDeficit = -Infinity;
  parties.forEach((p, i) => {
    const target = weights[i] / sumW;
    const deficit = target * (total + 1) - p.count;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = i;
    }
  });
  return best;
}

export async function tryFulfillForNewLead(leadId: string): Promise<void> {
  if (!prisma) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.assignedUserId) return;

  // Testing hold-back: a lead tagged as a product under evaluation goes straight
  // to the house (Ryan) before any buyer distribution runs.
  if (await routeHeldBackTagToHouse(lead)) return;

  const pendingOrders = await prisma.order.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING", "DELIVERING"] },
      // Match direct-pool orders and any aged-bucket order drawing from this pool.
      packageId: { in: purchasableIdsForPool(lead.packageId) },
      OR: [
        { filterStates: { isEmpty: true } },
        { filterStates: { has: lead.state } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: { leads: { where: { trashedAt: null }, select: { id: true } } },
  });

  const house = await getHouseAccount();

  // Orders that can take THIS lead: cover its state, in the age window, not full.
  const eligibleOrders = pendingOrders.filter(
    (o) => o.filterStates.length > 0 && o.leads.length < o.quantity && leadAgeEligibleForOrder(o, lead.receivedAt),
  );

  // LICENSING GUARD: never deliver a lead in a state the recipient isn't licensed
  // in. We check the recipient's licensedStates; if they haven't set any yet, fall
  // back to the order's states (can't enforce licensing we don't have on file).
  const recipientIds = [...new Set(eligibleOrders.map((o) => o.deliverToUserId ?? o.userId))];
  const licRows = recipientIds.length
    ? await prisma.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, licensedStates: true } })
    : [];
  const licensedById = new Map(licRows.map((u) => [u.id, u.licensedStates ?? []]));
  const licensedOrders = eligibleOrders.filter((o) => {
    const rid = o.deliverToUserId ?? o.userId;
    const ls = licensedById.get(rid) ?? [];
    return ls.length === 0 || ls.includes(lead.state);
  });

  // ── True round-robin intake (owner directive, Oct 2026) ─────────────────
  // Rotate each incoming lead across every DISTINCT buyer with an eligible open
  // order (a buyer with two orders is still one slot), plus the house (Ryan) as a
  // final slot, tracked by a persistent cursor so "whoever got the last lead"
  // determines who's next. Replaces the coverage-weighted split. When no open
  // order is eligible, the lead goes to the house (catch-all).
  if (licensedOrders.length > 0 && house) {
    const orderForRecipient = new Map<string, string>(); // recipientId -> oldest eligible orderId
    const buyerIds: string[] = [];
    for (const o of licensedOrders) {
      const rid = o.deliverToUserId ?? o.userId;
      if (rid === house.userId) continue; // the house is its own rotation slot
      if (!orderForRecipient.has(rid)) {
        orderForRecipient.set(rid, o.id);
        buyerIds.push(rid);
      }
    }
    const rotation = [...buyerIds, house.userId];

    // Rotate PER STATE so each state alternates independently — a buyer gets an
    // EXACT equal (50/50, or 1/N with more buyers) share of the leads in THEIR
    // states, every time, regardless of other states. A lead in a house-only
    // state can no longer eat the buyer's turn in their states. Equal
    // opportunity, NEVER weighted (owner directive, Oct 5 2026).
    const cursorKey = `st:${lead.state}`;
    const cursor = await prisma.distributionCursor.findUnique({ where: { id: cursorKey } });
    const lastIdx = cursor?.lastRecipientId ? rotation.indexOf(cursor.lastRecipientId) : -1;
    const setCursor = (rid: string) =>
      prisma!.distributionCursor.upsert({
        where: { id: cursorKey },
        update: { lastRecipientId: rid },
        create: { id: cursorKey, lastRecipientId: rid },
      });

    // Start at the slot AFTER whoever got the last lead; take the first that accepts.
    for (let step = 1; step <= rotation.length; step++) {
      const rid = rotation[(lastIdx + step) % rotation.length];
      if (rid === house.userId) {
        // House's turn: an owed replacement (to a paying client) outranks the
        // house; otherwise the lead goes to the house CRM (Ryan).
        if (await tryReplacementForFreshLead(leadId)) { await setCursor(rid); return; }
        if (await assignLeadToHouse(leadId, "round-robin turn (house)")) { await setCursor(rid); return; }
        continue; // house declined (e.g. lead not fresh) — try the next buyer
      }
      const assigned = await fulfillOrder(orderForRecipient.get(rid)!, { onlyLeadId: leadId });
      if (assigned > 0) { await setCursor(rid); return; }
      // That buyer's order filled concurrently — advance to the next slot.
    }
  }

  // No eligible open order (or the rotation couldn't place it): a pending
  // replacement first, then the house catch-all so every lead lands somewhere.
  if (await tryReplacementForFreshLead(leadId)) return;
  await assignLeadToHouse(leadId, "not claimed by any open order");
}
