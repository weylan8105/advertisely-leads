import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads/delivered-count?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * How many real (non-trashed) leads were DELIVERED to the caller's own pipeline
 * (assignedAt) in the date range. For admin/house accounts that receive leads
 * without placing a Stripe order, so they can reconcile what to "buy" internally.
 * Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if ((session?.user as any)?.role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ count: 0 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const assignedAt: { gte?: Date; lte?: Date } = {};
  if (from) { const d = new Date(from); if (!isNaN(d.getTime())) assignedAt.gte = d; }
  if (to) { const d = new Date(to); if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); assignedAt.lte = d; } }

  const count = await prisma.lead.count({
    where: {
      assignedUserId: callerId,
      trashedAt: null,
      ...(assignedAt.gte || assignedAt.lte ? { assignedAt } : {}),
    },
  });

  return NextResponse.json({ count, from, to });
}
