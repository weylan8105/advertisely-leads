import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { findPackage, leadPoolIdsFor } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";

export type ReplacementOutcome =
  | { ok: true; status: "FULFILLED"; replacementLeadId: string; replacementName: string; replacementState: string; notified: boolean }
  | { ok: false; status: "ALREADY_REPLACED"; note: string }
  | { ok: false; status: "NOT_PENDING" }
  | { ok: false; status: "NO_STOCK"; state: string; poolIds: string[] }
  | { ok: false; status: "LEAD_MISSING" };

/**
 * Resolve an admin user id to stamp as the reviewer on auto-processed requests.
 * Falls back to null (reviewedById is optional) if no admin exists.
 */
async function systemReviewerId(): Promise<string | null> {
  if (!prisma) return null;
  const admin = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/**
 * Auto-fulfill a single replacement request when matching inventory exists.
 *
 * Policy (see memory: advertisely-fulfillment-policy #4): pick the FRESHEST
 * lead from the SAME pool the bad lead came from, unassigned, not a test lead,
 * in the order's age window — preferring the same state, but falling back to ANY
 * state the client ordered (the order's filterStates) so a replacement can still
 * be issued when that exact state is out of stock. Assign it to the requesting
 * agent on the SAME order. Mark the bad lead REPLACED (+ trash it so it never
 * resells). The swap is net-neutral,
 * so the order's fulfilledCount is left untouched. Sends the standard delivery
 * email for the one replacement lead unless notify=false.
 *
 * Guards against the double-replacement bug: if the bad lead is already
 * REPLACED/trashed, the request is auto-closed as a duplicate rather than
 * handing out a second free lead.
 */
export async function fulfillReplacement(
  requestId: string,
  opts: { reviewerId?: string | null; notify?: boolean } = {},
): Promise<ReplacementOutcome> {
  if (!prisma) return { ok: false, status: "LEAD_MISSING" };
  const notify = opts.notify ?? true;

  const request = await prisma.replacementRequest.findUnique({
    where: { id: requestId },
    include: { lead: true },
  });
  if (!request) return { ok: false, status: "LEAD_MISSING" };
  if (request.status !== "PENDING") return { ok: false, status: "NOT_PENDING" };

  const bad = request.lead;
  if (!bad) return { ok: false, status: "LEAD_MISSING" };

  const reviewerId = opts.reviewerId ?? (await systemReviewerId());

  // Duplicate guard: the bad lead was already replaced/trashed. Don't issue a
  // second free lead — close the request pointing at the prior resolution.
  if (bad.status === "REPLACED" || bad.trashedAt) {
    const note = `Auto-closed: lead "${bad.name}" (${bad.state}) was already replaced${
      bad.trashedAt ? ` on ${bad.trashedAt.toISOString().slice(0, 10)}` : ""
    }. No second replacement issued.`;
    await prisma.replacementRequest.update({
      where: { id: request.id },
      data: { status: "DENIED", reviewedById: reviewerId, reviewedAt: new Date(), adminNote: note },
    });
    return { ok: false, status: "ALREADY_REPLACED", note };
  }

  // The agent who owns the bad lead (and thus the replacement) + the order it sits on.
  const assignee = bad.assignedUserId ?? request.requestedById;
  const orderId = bad.orderId ?? null;
  const poolIds = leadPoolIdsFor(bad.packageId);

  // Match the age window of the order being replaced (fall back to the package)
  // so a Real-Time buyer's replacement is also fresh — never an aged lead. Also
  // capture the states the client ordered: the replacement may be backfilled
  // from ANY of them, not only the bad lead's state (owner directive, Sep 2026).
  const replAtFilter: { gt?: Date; lte?: Date } = {};
  let orderedStates: string[] | null = null; // null = no order; [] = all-states order
  if (orderId) {
    const ord = await prisma.order.findUnique({
      where: { id: orderId },
      select: { filterStates: true, filterAgeMinDays: true, filterAgeMaxDays: true, packageId: true },
    });
    if (ord) orderedStates = ord.filterStates;
    const pk = findPackage(ord?.packageId ?? bad.packageId);
    const maxD = ord?.filterAgeMaxDays ?? pk?.ageMaxDays ?? null;
    const minD = ord?.filterAgeMinDays ?? pk?.ageMinDays ?? null;
    const dayMs = 86_400_000;
    const nowMs = Date.now();
    if (maxD != null) replAtFilter.gt = new Date(nowMs - maxD * dayMs);
    if (minD != null) replAtFilter.lte = new Date(nowMs - minD * dayMs);
  }

  // Base match: same IUL pool, unassigned, not a test lead, not the bad lead
  // itself. State and age are applied as tiered PREFERENCES below, never hard
  // gates: a replacement must issue whenever the client has that state in their
  // order, even if the only stock left is older than the order's fresh window
  // (owner directive: "all states can replace as long as the client has that
  // state in their order").
  const baseWhere: Prisma.LeadWhereInput = {
    packageId: { in: poolIds },
    assignedUserId: null,
    orderId: null,
    trashedAt: null,
    id: { not: bad.id },
    ...NOT_TEST_LEAD,
  };

  // State preference: like-for-like same state first, then ANY state the client
  // ordered (order's filterStates; empty filterStates = all-states order → any).
  // A lead with no order only backfills within its own state.
  const stateSets: Prisma.LeadWhereInput[] = [{ state: bad.state }];
  if (orderId) {
    stateSets.push(orderedStates && orderedStates.length ? { state: { in: orderedStates } } : {});
  }

  // Age preference: the order's fresh window first, then ANY age so aged stock
  // can still make a client whole rather than leaving the request pending.
  const ageSets: Prisma.LeadWhereInput[] =
    replAtFilter.gt || replAtFilter.lte ? [{ receivedAt: replAtFilter }, {}] : [{}];

  // Walk preferences from best (fresh + same state) to last resort (any age, any
  // ordered state), always taking the freshest match within each tier.
  let replacement: Awaited<ReturnType<typeof prisma.lead.findFirst>> = null;
  for (const ageSet of ageSets) {
    for (const stateSet of stateSets) {
      replacement = await prisma.lead.findFirst({
        where: { ...baseWhere, ...stateSet, ...ageSet },
        orderBy: { receivedAt: "desc" },
      });
      if (replacement) break;
    }
    if (replacement) break;
  }

  if (!replacement) {
    return { ok: false, status: "NO_STOCK", state: bad.state, poolIds };
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // Assign the replacement to the agent on the same order (guard against a
    // concurrent grab with the assignedUserId:null condition).
    await tx.lead.updateMany({
      where: { id: replacement.id, assignedUserId: null },
      data: {
        assignedUserId: assignee,
        assignedAt: now,
        orderId,
        ...(bad.organizationId ? { organizationId: bad.organizationId } : {}),
      },
    });

    // Retire the bad lead: REPLACED + trashed so it never resells. Keep it on
    // the order as an audit record. fulfilledCount is intentionally NOT changed.
    await tx.lead.update({
      where: { id: bad.id },
      data: {
        status: "REPLACED",
        disposition: `Replaced: ${request.reason}`,
        trashedAt: bad.trashedAt ?? now,
      },
    });

    await tx.leadActivity.createMany({
      data: [
        { leadId: replacement.id, type: "LEAD_ASSIGNED", body: `Replacement for lead ${bad.id} (request ${request.id}).` },
        { leadId: bad.id, type: "STATUS_CHANGED", body: `Marked REPLACED — swapped for ${replacement.name} (${replacement.state}).` },
      ],
    });

    await tx.replacementRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        reviewedById: reviewerId,
        reviewedAt: now,
        adminNote: `Auto-fulfilled: ${replacement.name} (${replacement.phone}, ${replacement.state}) delivered; bad lead trashed.`,
      },
    });
  });

  // Notify the agent their replacement is ready (standard delivery email).
  let notified = false;
  if (notify && isEmailConfigured) {
    try {
      const agent = await prisma.user.findUnique({
        where: { id: assignee },
        select: { email: true, name: true },
      });
      if (agent?.email) {
        await sendLeadDeliveryEmail({
          agentEmail: agent.email,
          agentName: agent.name ?? "Agent",
          leadCount: 1,
          packageName: findPackage(bad.packageId)?.name ?? bad.packageId,
          orderId: orderId ?? request.id,
          leads: [{
            name: replacement.name,
            phone: replacement.phone,
            email: replacement.email,
            state: replacement.state,
            occupation: replacement.occupation,
            age: replacement.age,
            income: replacement.income,
            intentReason: replacement.intentReason,
          }],
        });
        notified = true;
      }
    } catch (err) {
      console.warn("Replacement delivery email failed:", err);
    }
  }

  return {
    ok: true,
    status: "FULFILLED",
    replacementLeadId: replacement.id,
    replacementName: replacement.name,
    replacementState: replacement.state,
    notified,
  };
}

/**
 * Sweep every PENDING replacement request and auto-fulfill the ones that have
 * matching stock. Duplicates are auto-closed; short-stock requests are left
 * PENDING for manual review. Returns a per-request summary.
 */
export async function autoFulfillPendingReplacements(
  opts: { notify?: boolean } = {},
): Promise<{ processed: number; fulfilled: number; closedDuplicate: number; pendingNoStock: number; results: Array<{ requestId: string; outcome: ReplacementOutcome }> }> {
  if (!prisma) return { processed: 0, fulfilled: 0, closedDuplicate: 0, pendingNoStock: 0, results: [] };
  const reviewerId = await systemReviewerId();
  const pending = await prisma.replacementRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const results: Array<{ requestId: string; outcome: ReplacementOutcome }> = [];
  let fulfilled = 0, closedDuplicate = 0, pendingNoStock = 0;
  for (const { id } of pending) {
    const outcome = await fulfillReplacement(id, { reviewerId, notify: opts.notify });
    results.push({ requestId: id, outcome });
    if (outcome.status === "FULFILLED") fulfilled++;
    else if (outcome.status === "ALREADY_REPLACED") closedDuplicate++;
    else if (outcome.status === "NO_STOCK") pendingNoStock++;
  }
  return { processed: pending.length, fulfilled, closedDuplicate, pendingNoStock, results };
}
