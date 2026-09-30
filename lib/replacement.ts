import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { findPackage, leadPoolIdsFor } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";

// Replacements are fresh-only: a candidate must have entered the CRM within the
// last 48 hours (owner directive Sep 30 2026). Module-scoped so both the
// single-request fulfiller and the intake helper use the same definition.
const FRESH_MS = 48 * 60 * 60 * 1000;

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
  opts: { reviewerId?: string | null; notify?: boolean; onlyLeadId?: string } = {},
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

  // Capture the states the client ordered: a replacement may come from ANY of
  // them, not only the bad lead's state (owner directive, Sep 2026).
  let orderedStates: string[] | null = null; // null = no order; [] = all-states order
  if (orderId) {
    const ord = await prisma.order.findUnique({
      where: { id: orderId },
      select: { filterStates: true },
    });
    if (ord) orderedStates = ord.filterStates;
  }

  // Replacements are ALWAYS fresh: a lead that entered the CRM within the last
  // 48 hours, regardless of the order's tier. No aged fallback — if no fresh
  // lead is available the request stays pending rather than handing out an aged
  // one (owner directive Sep 30 2026: "the leads need to be fresh").
  const freshFilter: Prisma.LeadWhereInput = { receivedAt: { gt: new Date(Date.now() - FRESH_MS) } };

  // Base match: same IUL pool, fresh (<=48h), unassigned, not a test lead, not
  // the bad lead itself. STATE is the only relaxed dimension — a replacement can
  // come from any state the client ordered when the exact state is dry. When the
  // caller pins `onlyLeadId` (intake: use THIS just-arrived lead or nothing), the
  // search is constrained to that lead, still validated against every gate here.
  const baseWhere: Prisma.LeadWhereInput = {
    packageId: { in: poolIds },
    assignedUserId: null,
    orderId: null,
    trashedAt: null,
    id: opts.onlyLeadId && opts.onlyLeadId !== bad.id ? opts.onlyLeadId : { not: bad.id },
    ...freshFilter,
    ...NOT_TEST_LEAD,
  };

  // State preference: like-for-like same state first, then ANY state the client
  // ordered (order's filterStates; empty filterStates = all-states order → any).
  // A lead with no order only backfills within its own state.
  const stateSets: Prisma.LeadWhereInput[] = [{ state: bad.state }];
  if (orderId) {
    stateSets.push(orderedStates && orderedStates.length ? { state: { in: orderedStates } } : {});
  }

  // Freshest match: same state first, then any ordered state — all within 48h.
  let replacement: Awaited<ReturnType<typeof prisma.lead.findFirst>> = null;
  for (const stateSet of stateSets) {
    replacement = await prisma.lead.findFirst({
      where: { ...baseWhere, ...stateSet },
      orderBy: { receivedAt: "desc" },
    });
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
 * Intake hook: a fresh lead has just arrived and NO open paid order claimed it
 * (the caller only reaches here for a leftover lead, so paid orders always keep
 * first claim). Offer this specific lead to a PENDING replacement before it
 * falls through to the house (Ryan). Among waiting requests we prefer a
 * like-for-like same-state match, then any request whose order covers this
 * lead's state, FIFO within each. Pins `onlyLeadId` so it can only ever consume
 * THIS lead, never divert another. Returns the fulfilled requestId, or null when
 * no pending request can use it.
 */
export async function tryReplacementForFreshLead(
  leadId: string,
  opts: { notify?: boolean } = {},
): Promise<string | null> {
  if (!prisma) return null;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, state: true, packageId: true, assignedUserId: true, orderId: true, trashedAt: true, receivedAt: true },
  });
  // Only an unclaimed, fresh (<=48h) lead can back a replacement.
  if (!lead || lead.assignedUserId || lead.orderId || lead.trashedAt) return null;
  if (Date.now() - lead.receivedAt.getTime() > FRESH_MS) return null;

  const leadPool = leadPoolIdsFor(lead.packageId);

  // Only requests the admin has GREENLIT (approved) auto-fill on intake — approval
  // is the gate. Un-reviewed pending requests wait for an approve/deny decision.
  const pending = await prisma.replacementRequest.findMany({
    where: { status: "PENDING", autoApproved: true },
    include: { lead: { select: { state: true, packageId: true, status: true, trashedAt: true } } },
    orderBy: { createdAt: "asc" }, // FIFO: the longest-waiting request first
  });

  // Keep requests whose bad lead draws from the same pool as this fresh lead,
  // and rank same-state (like-for-like) ahead of cross-state.
  const candidates = pending
    .filter(
      (r) =>
        r.lead &&
        !r.lead.trashedAt &&
        r.lead.status !== "REPLACED" &&
        leadPoolIdsFor(r.lead.packageId).some((p) => leadPool.includes(p)),
    )
    .sort((a, b) => Number(b.lead!.state === lead.state) - Number(a.lead!.state === lead.state));

  for (const req of candidates) {
    const outcome = await fulfillReplacement(req.id, { onlyLeadId: leadId, notify: opts.notify });
    if (outcome.ok) return req.id;
    // A non-ok outcome just means this lead didn't satisfy that request (its
    // state isn't on the request's order, the request was a duplicate, etc.) —
    // move on and let the lead fall through to the house if nothing matches.
  }
  return null;
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
