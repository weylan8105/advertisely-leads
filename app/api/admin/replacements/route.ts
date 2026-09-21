import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillReplacement, autoFulfillPendingReplacements } from "@/lib/replacement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/replacements
 * Returns all pending replacement requests. Admin only.
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
    return NextResponse.json({ replacements: [] });
  }

  const replacements = await prisma.replacementRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      lead: { select: { id: true, name: true, phone: true, email: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
    },
  });

  return NextResponse.json({ replacements });
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
  const { leadId, reason } = body as { leadId?: string; reason?: string };

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

  const request = await prisma.replacementRequest.create({
    data: {
      leadId,
      reason: reason ?? "No reason provided",
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
 * Body: { requestId: string; action: "approve" | "deny"; adminNote?: string }
 * Admin approves or denies a replacement request.
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
  const { requestId, action, adminNote } = body as {
    requestId?: string;
    action?: "approve" | "deny" | "autofulfill";
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
      return NextResponse.json(
        { error: `No matching ${outcome.state} inventory to fulfill this replacement right now. Left pending.` },
        { status: 422 },
      );
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
