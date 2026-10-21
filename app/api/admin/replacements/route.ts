import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillReplacement, autoFulfillPendingReplacements } from "@/lib/replacement";
import { IUL_POOL_IDS } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";
import { isEligibleReasonCode, reasonLabel, ELIGIBLE_REPLACEMENT_REASONS, replacementWindowClosed, REPLACEMENT_WINDOW_HOURS } from "@/lib/replacementReasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FRESH_MS = 48 * 60 * 60 * 1000;

/**
 * GET /api/admin/replacements
 * Returns all replacement requests. Each PENDING request is flagged with
 * `awaitingFreshStock` = true when no fresh (<=48h) lead exists in a state that
 * could currently fulfill it, so admins can see which states are backed up
 * waiting on fresh inventory. Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ replacements: [], backedUpStates: [] });
  }

  const replacements = await prisma.replacementRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      lead: {
        select: {
          id: true, name: true, phone: true, email: true, state: true,
          status: true, trashedAt: true, assignedUserId: true,
          orderId: true, order: { select: { filterStates: true } },
        },
      },
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  });

  // Leads that already have an open or completed request — a denial on the same lead
  // can't be undone (that would create a second live request / double replacement).
  const leadsWithLiveRequest = new Set(
    replacements.filter((r) => r.status === "PENDING" || r.status === "APPROVED").map((r) => r.leadId),
  );
  // A denial can be undone back to "pending review" unless the lead has since been
  // replaced or trashed (auto-closed duplicates land as DENIED for exactly that reason).
  const canUndoDeny = (r: (typeof replacements)[number]): boolean =>
    r.status === "DENIED" &&
    !!r.lead &&
    r.lead.status !== "REPLACED" &&
    // still owned by whoever asked — otherwise approving it would replace someone else's lead
    r.lead.assignedUserId === r.requestedById &&
    !r.lead.trashedAt &&
    !leadsWithLiveRequest.has(r.leadId);

  // States that currently have fresh (<=48h) unassigned IUL inventory — the only
  // stock a replacement can draw from (fresh-only rule). Mirrors fulfillReplacement.
  const freshRows = await prisma.lead.groupBy({
    by: ["state"],
    where: {
      packageId: { in: IUL_POOL_IDS },
      assignedUserId: null,
      orderId: null,
      trashedAt: null,
      receivedAt: { gt: new Date(Date.now() - FRESH_MS) },
      ...NOT_TEST_LEAD,
    },
    _count: true,
  });
  const freshStates = new Set(
    freshRows.filter((r) => (r._count as number) > 0 && r.state).map((r) => r.state),
  );
  const anyFresh = freshStates.size > 0;

  // Can a pending request be fulfilled right now? Same-state stock, or (if it has
  // an order) stock in any state the client ordered (empty filterStates = all).
  const fulfillableNow = (lead: (typeof replacements)[number]["lead"]): boolean => {
    if (!lead) return false;
    if (lead.state && freshStates.has(lead.state)) return true;
    if (!lead.orderId) return false; // no order → same-state only
    const os = lead.order?.filterStates ?? [];
    if (os.length === 0) return anyFresh; // all-states order
    return os.some((s) => freshStates.has(s));
  };

  // "Waiting on fresh stock" = approved (greenlit) + queued, but no fresh lead is
  // available yet to fill it. These are the ones that will auto-fill on intake.
  const annotated = replacements.map((r) => ({
    ...r,
    awaitingFreshStock: r.status === "PENDING" && r.autoApproved && !fulfillableNow(r.lead),
    undoable: canUndoDeny(r),
  }));

  const backedUpStates = Array.from(
    new Set(
      annotated
        .filter((r) => r.awaitingFreshStock && r.lead?.state && /^[A-Z]{2}$/.test(r.lead.state))
        .map((r) => r.lead!.state),
    ),
  ).sort();

  return NextResponse.json({ replacements: annotated, backedUpStates });
}

/**
 * POST /api/admin/replacements
 * Body: { leadId: string; reason: string }
 * Creates a new replacement request (agent-facing).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { leadId, reason, reasonCode } = body as { leadId?: string; reason?: string; reasonCode?: string };

  if (!leadId) {
    return NextResponse.json({ error: "leadId is required" }, { status: 400 });
  }

  if (!isDatabaseConfigured || !prisma) {
    // Return success stub when DB is not configured (dev/demo mode)
    return NextResponse.json({
      success: true,
      message: "Replacement request submitted. Our team will review within 72 hours.",
    });
  }

  const existing = await prisma.replacementRequest.findFirst({
    where: { leadId, status: "PENDING" },
  });

  if (existing) {
    return NextResponse.json(
      { error: "A replacement request is already pending for this lead." },
      { status: 409 },
    );
  }

  // One shot per lead: once a request was denied, the same lead can't be
  // re-submitted. (An admin can still Undo the denial from the queue.)
  const denied = await prisma.replacementRequest.findFirst({
    where: { leadId, status: "DENIED" },
    select: { id: true },
  });
  if (denied) {
    return NextResponse.json(
      {
        error: "A replacement for this lead was already reviewed and denied, so it can't be requested again.",
        alreadyDenied: true,
      },
      { status: 409 },
    );
  }

  // Hard gate: the replacement window (72h from delivery) must still be open.
  const windowLead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { assignedAt: true },
  });
  if (replacementWindowClosed(windowLead?.assignedAt ?? null)) {
    return NextResponse.json(
      {
        error: `This lead is outside the ${REPLACEMENT_WINDOW_HOURS}-hour replacement window (measured from delivery), so it's no longer eligible for a replacement.`,
        windowClosed: true,
      },
      { status: 409 },
    );
  }

  // Replacements are issued only for specific, verifiable reasons (parity with
  // our published policy). Reject anything else up front.
  if (!isEligibleReasonCode(reasonCode)) {
    return NextResponse.json(
      {
        error:
          "That isn't an eligible replacement reason. We replace disconnected numbers, duplicates (within 60 days), prospects over the age limit, and out-of-state leads. No-answers, voicemails, and wrong info aren't eligible.",
        ineligibleReason: true,
        eligibleReasons: ELIGIBLE_REPLACEMENT_REASONS.map((r) => ({ code: r.code, label: r.label })),
      },
      { status: 400 },
    );
  }

  const capLead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { orderId: true, state: true },
  });

  if (capLead?.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: capLead.orderId },
      select: { quantity: true, filterStates: true },
    });
    if (order) {
      // Out-of-state is auto-verifiable: we never deliver off-order leads, so a
      // lead whose state IS on the order can't qualify as out-of-territory.
      if (
        reasonCode === "out_of_state" &&
        order.filterStates.length > 0 &&
        capLead.state &&
        order.filterStates.includes(capLead.state)
      ) {
        return NextResponse.json(
          {
            error: `This lead is in ${capLead.state}, which is one of the states on your order — so it doesn't qualify as out-of-territory.`,
            ineligibleReason: true,
          },
          { status: 400 },
        );
      }

      // 20% replacement cap per order (rounded up), counting prior non-denied
      // requests. Block at the cap and direct the client to a new order.
      const cap = Math.ceil(order.quantity * 0.2);
      const used = await prisma.replacementRequest.count({
        where: {
          lead: { orderId: capLead.orderId },
          status: { in: ["PENDING", "APPROVED"] },
        },
      });
      if (used >= cap) {
        return NextResponse.json(
          {
            error: `You've reached the replacement limit for this order — up to 20% (${cap} of ${order.quantity} leads) can be replaced. To get more leads, please place a new order.`,
            capExceeded: true,
            cap,
            used,
            orderQuantity: order.quantity,
            marketplaceUrl: "/marketplace",
          },
          { status: 409 },
        );
      }
    }
  }

  const request = await prisma.replacementRequest.create({
    data: {
      leadId,
      // Store the eligible category plus any free-text detail the client added.
      reason: `${reasonLabel(reasonCode)}${reason && reason !== "No detail provided" ? ` — ${reason}` : ""}`,
      requestedById: user.id,
      status: "PENDING",
    },
  });

  // Auto-fulfillment: if matching same-state inventory exists in the bad lead's
  // pool, deliver the replacement immediately (no manual review needed). Falls
  // back to the 72-hour manual-review message when stock is short. Never blocks
  // the request on a fulfillment error.
  try {
    const outcome = await fulfillReplacement(request.id, { notify: true });
    if (outcome.status === "FULFILLED") {
      return NextResponse.json({
        success: true,
        requestId: request.id,
        autoFulfilled: true,
        message: `Replacement approved and delivered instantly — ${outcome.replacementName} (${outcome.replacementState}) is in your dashboard${outcome.notified ? " and on its way by email" : ""}.`,
      });
    }
    if (outcome.status === "ALREADY_REPLACED") {
      return NextResponse.json({
        success: true,
        requestId: request.id,
        autoFulfilled: false,
        message: "This lead was already replaced previously, so no additional replacement was issued.",
      });
    }
  } catch (err) {
    console.warn("Auto-fulfill on replacement request failed:", err);
  }

  return NextResponse.json({
    success: true,
    requestId: request.id,
    autoFulfilled: false,
    message: "Replacement request submitted. Our team will review within 72 hours.",
  });
}

/**
 * PATCH /api/admin/replacements
 * Body: { requestId: string; action: "approve" | "deny" | "undo-deny"; adminNote?: string }
 * Admin approves or denies a replacement request, or undoes a denial (back to
 * pending review) when it was a mistake.
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;

  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { requestId, action, adminNote, force } = body as {
    requestId?: string;
    force?: boolean;
    action?: "approve" | "deny" | "autofulfill" | "approve-all" | "undo-deny";
    adminNote?: string;
  };

  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({
      success: true,
      message: action === "deny" ? "Request denied." : "Request approved.",
    });
  }

  // Batch sweep: auto-fulfill every PENDING request that has matching stock.
  if (action === "autofulfill" && !requestId) {
    const summary = await autoFulfillPendingReplacements({ notify: true });
    return NextResponse.json({
      success: true,
      message: `Swept ${summary.processed} pending — ${summary.fulfilled} fulfilled, ${summary.closedDuplicate} closed as duplicates, ${summary.pendingNoStock} left pending (no stock).`,
      ...summary,
    });
  }

  // Batch approve: greenlight EVERY pending request at once. In-stock ones deliver
  // now; the rest are marked approved (autoApproved) and auto-fill when a fresh
  // lead arrives — same behavior as clicking Approve on each, in one click.
  if (action === "approve-all" && !requestId) {
    const pending = await prisma.replacementRequest.findMany({
      where: { status: "PENDING" },
      select: { id: true, lead: { select: { state: true } } },
    });
    let delivered = 0, queued = 0, closed = 0, failed = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const r of pending) {
      const outcome = await fulfillReplacement(r.id, { reviewerId: user.id, notify: true });
      if (outcome.status === "FULFILLED") delivered++;
      else if (outcome.status === "ALREADY_REPLACED") closed++;
      else if (outcome.status === "NO_STOCK") {
        await prisma.replacementRequest.update({
          where: { id: r.id },
          data: {
            autoApproved: true,
            reviewedById: user.id,
            reviewedAt: new Date(),
            adminNote: `Approved ${today} — queued for auto-fulfillment when a fresh ${r.lead?.state ?? ""} lead is available.`,
          },
        });
        queued++;
      } else failed++;
    }
    return NextResponse.json({
      success: true,
      processed: pending.length,
      delivered,
      queued,
      closed,
      failed,
      message: `Approved ${pending.length} request${pending.length === 1 ? "" : "s"} — ${delivered} delivered now, ${queued} queued to auto-fulfill when fresh leads arrive${closed ? `, ${closed} already replaced` : ""}.`,
    });
  }

  // Undo a denial made by mistake: DENIED -> PENDING (unreviewed), so it shows back
  // up in the queue for a fresh approve/deny. Refused when the lead was already
  // replaced or trashed (auto-closed duplicates), or when another open/approved
  // request exists for the same lead — either would risk a double replacement.
  if (action === "undo-deny") {
    if (!requestId) {
      return NextResponse.json({ error: "requestId is required" }, { status: 400 });
    }
    const request = await prisma.replacementRequest.findUnique({
      where: { id: requestId },
      include: { lead: { select: { id: true, status: true, trashedAt: true, assignedUserId: true, orderId: true, order: { select: { quantity: true } } } } },
    });
    if (!request) {
      return NextResponse.json({ error: "Replacement request not found" }, { status: 404 });
    }
    if (request.status !== "DENIED") {
      return NextResponse.json({ error: "Only a denied request can be undone." }, { status: 409 });
    }
    if (!request.lead || request.lead.status === "REPLACED" || request.lead.trashedAt) {
      return NextResponse.json(
        { error: "This lead has already been replaced (or is in the trash), so the denial can't be undone." },
        { status: 409 },
      );
    }
    const other = await prisma.replacementRequest.findFirst({
      where: { leadId: request.leadId, id: { not: request.id }, status: { in: ["PENDING", "APPROVED"] } },
      select: { id: true, status: true },
    });
    if (other) {
      return NextResponse.json(
        { error: `This lead already has another ${other.status === "APPROVED" ? "completed" : "open"} replacement request, so this denial can't be undone.` },
        { status: 409 },
      );
    }
    if (request.lead.assignedUserId !== request.requestedById) {
      return NextResponse.json(
        { error: "This lead no longer belongs to the agent who asked for the replacement, so the denial can't be undone." },
        { status: 409 },
      );
    }
    // Same 20%-per-order cap the client hits when filing. The slot this denial freed
    // may have been used since; going over needs an explicit admin override (force).
    if (request.lead.orderId && request.lead.order && !force) {
      const cap = Math.ceil(request.lead.order.quantity * 0.2);
      const used = await prisma.replacementRequest.count({
        where: { lead: { orderId: request.lead.orderId }, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (used >= cap) {
        return NextResponse.json(
          {
            error: `This order is already at its replacement limit (${used} of ${cap}). Undoing would put it over.`,
            capExceeded: true, cap, used,
          },
          { status: 409 },
        );
      }
    }
    // One atomic statement: flips DENIED -> PENDING only if no other open/approved
    // request exists for the lead, so a double-click or a race can't create two.
    const res: number = await prisma.$executeRaw`
      UPDATE "ReplacementRequest"
      SET status = 'PENDING', "autoApproved" = false, "reviewedById" = NULL, "reviewedAt" = NULL, "adminNote" = NULL
      WHERE id = ${requestId} AND status = 'DENIED'
        AND NOT EXISTS (
          SELECT 1 FROM "ReplacementRequest" o
          WHERE o."leadId" = ${request.leadId} AND o.id <> ${requestId} AND o.status IN ('PENDING', 'APPROVED')
        )`;
    if (res === 0) {
      return NextResponse.json({ error: "This request changed in the meantime — refresh and try again." }, { status: 409 });
    }
    // Client-visible history line stays neutral; who undid it (and the cleared denial
    // note, which clients could see) is kept in metadata for the audit trail.
    await prisma.leadActivity.create({
      data: {
        leadId: request.leadId,
        type: "NOTE_ADDED",
        author: "Advertisely team",
        body: "Replacement request reopened for review (an earlier denial was undone).",
        metadata: {
          action: "replacement_undo_deny",
          requestId: request.id,
          undoneBy: user.id,
          undoneByName: user.name ?? user.email ?? null,
          previousReviewerId: request.reviewedById,
          previousReviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
          previousNote: request.adminNote,
        },
      },
    });
    return NextResponse.json({
      success: true,
      requestId,
      status: "PENDING",
      message: "Denial undone — the request is back in the queue for review.",
    });
  }

  if (!requestId || !action) {
    return NextResponse.json({ error: "requestId and action are required" }, { status: 400 });
  }

  if (!["approve", "deny", "autofulfill"].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve', 'deny', or 'autofulfill'" }, { status: 400 });
  }

  // Approve / autofulfill a single request → actually deliver a replacement lead.
  if (action === "approve" || action === "autofulfill") {
    const outcome = await fulfillReplacement(requestId, { reviewerId: user.id, notify: true });
    if (outcome.status === "FULFILLED") {
      return NextResponse.json({
        success: true,
        requestId,
        status: "APPROVED",
        message: `Replacement delivered: ${outcome.replacementName} (${outcome.replacementState}).`,
      });
    }
    if (outcome.status === "ALREADY_REPLACED") {
      return NextResponse.json({ success: true, requestId, status: "DENIED", message: outcome.note }, { status: 200 });
    }
    if (outcome.status === "NOT_PENDING") {
      return NextResponse.json({ error: "Request is not pending." }, { status: 409 });
    }
    if (outcome.status === "NO_STOCK") {
      // Greenlight it for automatic fulfillment: keep it PENDING but mark it
      // approved so it auto-fills the moment a matching fresh lead arrives — the
      // admin never has to come back and click approve again.
      await prisma.replacementRequest.update({
        where: { id: requestId },
        data: {
          autoApproved: true,
          reviewedById: user.id,
          reviewedAt: new Date(),
          adminNote:
            adminNote ??
            `Approved ${new Date().toISOString().slice(0, 10)} — queued for auto-fulfillment when a fresh ${outcome.state} lead is available.`,
        },
      });
      return NextResponse.json({
        success: true,
        requestId,
        status: "PENDING",
        queued: true,
        message: `Approved. No fresh ${outcome.state} lead is in stock yet — it will auto-fulfill as soon as one arrives. No need to check back.`,
      });
    }
    return NextResponse.json({ error: "Could not fulfill — lead missing." }, { status: 404 });
  }

  // Deny path (approve/autofulfill handled above).
  const request = await prisma.replacementRequest.findUnique({
    where: { id: requestId },
  });

  if (!request) {
    return NextResponse.json({ error: "Replacement request not found" }, { status: 404 });
  }

  if (request.status !== "PENDING") {
    return NextResponse.json(
      { error: `Request is already ${request.status.toLowerCase()}` },
      { status: 409 },
    );
  }

  const updated = await prisma.replacementRequest.update({
    where: { id: requestId },
    data: {
      status: "DENIED",
      reviewedById: user.id,
      reviewedAt: new Date(),
      adminNote: adminNote ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    requestId: updated.id,
    status: updated.status,
    message: "Replacement request denied successfully.",
  });
}
