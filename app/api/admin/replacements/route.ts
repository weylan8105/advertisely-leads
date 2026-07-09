import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

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

  return NextResponse.json({
    success: true,
    requestId: request.id,
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
    action?: "approve" | "deny";
    adminNote?: string;
  };

  if (!requestId || !action) {
    return NextResponse.json({ error: "requestId and action are required" }, { status: 400 });
  }

  if (!["approve", "deny"].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve' or 'deny'" }, { status: 400 });
  }

  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({
      success: true,
      message: `Request ${action === "approve" ? "approved" : "denied"}.`,
    });
  }

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
      status: action === "approve" ? "APPROVED" : "DENIED",
      reviewedById: user.id,
      reviewedAt: new Date(),
      adminNote: adminNote ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    requestId: updated.id,
    status: updated.status,
    message: `Replacement request ${action === "approve" ? "approved" : "denied"} successfully.`,
  });
}
