import { prisma } from "./prisma";
import { ensureOrgContext } from "./org";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { appendRows, isSheetsConfigured } from "./sheets";
import { buildExportRows } from "./leadExport";
import { findPackage, leadPoolIdsFor, purchasableIdsForPool } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";
import { coveredStates, assignLeadToHouse } from "@/lib/house";

/**
 * Attempt to fulfill one order by finding unassigned leads matching its filters.
 * Returns the number of leads newly assigned.
 *
 * This runs in two scenarios:
 *  1. Immediately after an order is placed (catch existing inventory).
 *  2. After each Meta webhook insert (assign fresh leads to pending orders).
 */
export async function fulfillOrder(orderId: string): Promise<number> {
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
    },
    orderBy: { receivedAt: "asc" },
    take: remaining,
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
export async function tryFulfillForNewLead(leadId: string): Promise<void> {
  if (!prisma) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.assignedUserId) return;

  const pendingOrders = await prisma.order.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING", "DELIVERING"] },
      // Match direct-pool orders and any aged-bucket order drawing from this pool.
      // fulfillOrder re-checks each order's age window, so mismatched ages are skipped.
      packageId: { in: purchasableIdsForPool(lead.packageId) },
      OR: [
        { filterStates: { isEmpty: true } },
        { filterStates: { has: lead.state } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });

  for (const order of pendingOrders) {
    const assigned = await fulfillOrder(order.id);
    if (assigned > 0) {
      // fulfillOrder assigns `remaining` matching leads, not necessarily THIS
      // one — confirm this lead actually landed before we stop.
      const check = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { assignedUserId: true },
      });
      if (check?.assignedUserId) return;
    }
  }

  // House catch-all: no open order covers this lead's state, so it would sit
  // unassigned in the pool. Route it to the house CRM (Ryan) so his team works
  // it while it's fresh, instead of letting it age out. States with an open
  // order are left alone (their inventory serves those orders + the aged store).
  const { states: covered, anyStateOrder } = await coveredStates();
  if (!anyStateOrder && lead.state && !covered.has(lead.state)) {
    await assignLeadToHouse(leadId, `no active order covers ${lead.state}`);
  }
}
