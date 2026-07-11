import { prisma } from "./prisma";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";

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
          packageName: order.packageId,
          orderId: order.id,
        });
      }
    } catch (emailErr) {
      // Never block fulfillment on email failure
      console.warn("Email notification failed:", emailErr);
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
