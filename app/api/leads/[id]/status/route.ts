import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Map UI title-cased labels → Prisma enum values
const STATUS_MAP: Record<string, string> = {
  New: "NEW",
  Contacted: "CONTACTED",
  "Appointment Set": "APPOINTMENT_SET",
  "No Answer": "NO_ANSWER",
  "Bad Number": "BAD_NUMBER",
  Closed: "CLOSED",
  Replaced: "REPLACED",
  // Also accept the raw enum values directly
  NEW: "NEW",
  CONTACTED: "CONTACTED",
  APPOINTMENT_SET: "APPOINTMENT_SET",
  NO_ANSWER: "NO_ANSWER",
  BAD_NUMBER: "BAD_NUMBER",
  CLOSED: "CLOSED",
  REPLACED: "REPLACED",
};

/**
 * PATCH /api/leads/[id]/status
 * Body: { status: string, disposition?: string }
 *
 * Updates the lead's status (and optionally disposition) in the database.
 * Scoped to the authenticated user's assigned leads only.
 * Logs a STATUS_CHANGED activity entry.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const role = (session.user as any).role as string | undefined;

  let body: { status?: string; disposition?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  const dbStatus = STATUS_MAP[body.status];
  if (!dbStatus) {
    return NextResponse.json(
      { error: `Invalid status "${body.status}". Valid values: ${Object.keys(STATUS_MAP).join(", ")}` },
      { status: 400 },
    );
  }

  // Verify the lead exists and belongs to this user (admins can update any lead)
  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, status: true },
  });

  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const isAdmin = role === "ADMIN";
  if (!isAdmin && lead.assignedUserId !== userId) {
    return NextResponse.json({ error: "Forbidden — this lead is not assigned to you" }, { status: 403 });
  }

  const previousStatus = lead.status;

  // Update lead status + optional disposition in a transaction with activity log
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: params.id },
      data: {
        status: dbStatus as any,
        ...(body.disposition !== undefined
          ? { disposition: body.disposition === "none" ? null : body.disposition }
          : {}),
        ...(dbStatus === "CONTACTED" || dbStatus === "APPOINTMENT_SET"
          ? { lastContactedAt: new Date() }
          : {}),
      },
    });

    // Log the status change in the activity timeline
    if (previousStatus !== dbStatus) {
      await tx.leadActivity.create({
        data: {
          leadId: params.id,
          type: "STATUS_CHANGED",
          author: session.user?.name ?? "Agent",
          body: `Status changed from ${previousStatus} to ${dbStatus}.`,
          metadata: { from: previousStatus, to: dbStatus },
        },
      });
    }
  });

  return NextResponse.json({
    success: true,
    leadId: params.id,
    status: dbStatus,
    disposition: body.disposition ?? null,
  });
}
