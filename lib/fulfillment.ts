import { prisma } from "./prisma";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { appendRows, isSheetsConfigured } from "./sheets";
import { buildExportRows } from "./leadExport";
import { findPackage } from "@/data/packages";
import { tagContact, enhancedWealthGHLConfig } from "./ghl";

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

  // Find unassigned leads matching this order's package + state filter
  const candidates = await prisma.lead.findMany({
    where: {
      packageId: order.packageId,
      assignedUserId: null,
      orderId: null,
      ...(order.filterStates.length > 0
        ? { state: { in: order.filterStates } }
        : {}),
      ...(order.filterIncomeMin
        ? { income: { gte: order.filterIncomeMin } }
        : {}),
    },
    orderBy: { receivedAt: "asc" },
    take: remaining,
  });

  if (candidates.length === 0) return 0;

  // Assign in a single transaction so concurrent fulfillment doesn't double-assign
  const assignedIds = candidates.map((l) => l.id);
  await prisma.$transaction(async (tx) => {
    await tx.lead.updateMany({
      where: { id: { in: assignedIds }, assignedUserId: null },
      data: {
        assignedUserId: order.userId,
        assignedAt: new Date(),
        orderId: order.id,
      },
    });

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
        body: `Lead assigned to customer via order ${order.id}.`,
      })),
    });
  });

  // Exclusive-sold suppression: tag each purchased lead's GHL contact
  // `advertisely-sold` so Enhanced Wealth stops dialing it. Their GHL workflow
  // moves tagged contacts into the Advertisely stage. No-op until the
  // ENHANCED_WEALTH_GHL_* env vars are set; never blocks fulfillment.
  const ewGHL = enhancedWealthGHLConfig();
  if (ewGHL) {
    for (const l of candidates) {
      if (!l.ghlContactId) continue;
      try {
        const r = await tagContact(l.ghlContactId, ["advertisely-sold"], ewGHL);
        if (r.ok) {
          await prisma.lead.update({
            where: { id: l.id },
            data: { ghlSoldTaggedAt: new Date() },
          });
        } else {
          await prisma.exportLog
            .create({
              data: {
                userId: order.userId,
                leadId: l.id,
                destination: "ghl-sold-tag",
                status: "FAILED",
                responseCode: r.status,
                errorMessage: r.error,
              },
            })
            .catch(() => {});
        }
      } catch (err) {
        console.warn("GHL sold-tag failed for lead", l.id, err);
      }
    }
  }

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
      packageId: lead.packageId,
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
