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
 * same-state lead from the SAME pool the bad lead came from, unassigned, not a
 * test lead, and assign it to the requesting agent on the SAME order. Mark the
 * bad lead REPLACED (+ trash it so it never resells). The swap is net-neutral,
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

  // Pick the freshest equal-or-better lead: same pool, same state, unassigned,
  // not a test lead, not the bad lead itself.
  const replacement = await prisma.lead.findFirst({
    where: {
      packageId: { in: poolIds },
      state: bad.state,
      assignedUserId: null,
      orderId: null,
      trashedAt: null,
      id: { not: bad.id },
      ...NOT_TEST_LEAD,
    },
    orderBy: { receivedAt: "desc" },
  });

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
