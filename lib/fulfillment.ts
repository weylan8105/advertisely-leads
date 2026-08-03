import { prisma } from "./prisma";
import { ensureOrgContext } from "./org";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { appendRows, isSheetsConfigured } from "./sheets";
import { buildExportRows } from "./leadExport";
import { findPackage, leadPoolFor, purchasableIdsForPool } from "@/data/packages";

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
    include: { leads: { select: { id: true } } },
  });
  if (!order) return 0;
  if (order.status === "DELIVERED" || order.status === "REFUNDED") return 0;

  const remaining = order.quantity - order.fulfilledCount;
  if (remaining <= 0) return 0;

  // Aged buckets carry an age window (days) relative to receivedAt. Translate
  // it into a receivedAt range; null bounds are left open.
  const dayMs = 86_400_000;
  const nowMs = Date.now();
  // ageMaxDays is the exclusive upper edge (shared with the next bucket's
  // ageMinDays) → gt, so adjacent buckets tile with no gap or overlap.
  const receivedAtFilter: { gt?: Date; lte?: Date } = {};
  if (order.filterAgeMaxDays != null) receivedAtFilter.gt = new Date(nowMs - order.filterAgeMaxDays * dayMs);
  if (order.filterAgeMinDays != null) receivedAtFilter.lte = new Date(nowMs - order.filterAgeMinDays * dayMs);

  // Find unassigned leads from this order's underlying lead pool, matching its
  // state + income + age filters. Buckets resolve to their pool (e.g. aged-iul).
  const candidates = await prisma.lead.findMany({
    where: {
      packageId: leadPoolFor(order.packageId),
      assignedUserId: null,
      orderId: null,
      ...(order.filterStates.length > 0
        ? { state: { in: order.filterStates } }
        : {}),
      ...(order.filterIncomeMin
        ? { income: { gte: order.filterIncomeMin } }
        : {}),
      ...(receivedAtFilter.gt || receivedAtFilter.lte ? { receivedAt: receivedAtFilter } : {}),
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
  if (orgId) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
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
      mode = org.distributionMode;
      rrCursor = org.rrCursor;
      rotation = org.memberships.map((m) => m.userId);
    }
  }
  const useRR = mode === "ROUND_ROBIN" && rotation.length > 0;

  // leadId → assigned userId
  const assigneeOf = new Map<string, string>();
  candidates.forEach((l, i) => {
    assigneeOf.set(l.id, useRR ? rotation[(rrCursor + i) % rotation.length] : order.userId);
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

    const newFulfilled = order.fulfilledCount + candidates.length;
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

  // Send email notification to the agent
  if (candidates.length > 0 && isEmailConfigured) {
    try {
      const user = await prisma?.user.findUnique({
        where: { id: order.userId },
        select: { email: true, name: true },
      });
      if (user?.email) {
        await sendLeadDeliveryEmail({
          agentEmail: user.email,
          agentName: user.name ?? "Agent",
          leadCount: candidates.length,
          packageName: findPackage(order.packageId)?.name ?? order.packageId,
          orderId: order.id,
          leads: candidates.map((l) => ({
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
    if (assigned > 0) break; // This lead got placed
  }
}
