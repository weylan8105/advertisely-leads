import { prisma } from "./prisma";
import { findPackage, leadPoolIdsFor } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";

/**
 * How many leads are actually available to sell for a given tier (age window)
 * and optional set of states — i.e. unassigned, not on an order, in the tier's
 * underlying pool, matching the tier's age window and (if given) the states.
 * This is the real-time cap the store must not let an order exceed.
 */
export async function availableForPackage(packageId: string, states: string[] = []): Promise<number> {
  if (!prisma) return 0;
  const pkg = findPackage(packageId);
  if (!pkg) return 0;

  const pools = leadPoolIdsFor(packageId);
  const DAY = 86_400_000;
  const now = Date.now();
  // Age window → receivedAt range (exclusive upper edge, matching fulfillment).
  const receivedAt: { gt?: Date; lte?: Date } = {};
  if (pkg.ageMaxDays != null) receivedAt.gt = new Date(now - pkg.ageMaxDays * DAY);
  if (pkg.ageMinDays != null) receivedAt.lte = new Date(now - pkg.ageMinDays * DAY);

  const cleanStates = states.map((s) => String(s).toUpperCase()).filter(Boolean);

  return prisma.lead.count({
    where: {
      assignedUserId: null,
      orderId: null,
      packageId: { in: pools },
      ...(cleanStates.length ? { state: { in: cleanStates } } : {}),
      ...(receivedAt.gt || receivedAt.lte ? { receivedAt } : {}),
      ...NOT_TEST_LEAD, // don't count fake/test leads as sellable
    },
  });
}

// Fresh (<48h) is generated-to-order and intentionally sellable ahead of stock,
// per the standing fulfillment policy — so it is exempt from the hard cap.
export const GENERATED_TO_ORDER = new Set<string>(["iul-fresh"]);
