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
 * Leads TRANSFERRED to the caller from another agent (manual or bulk reassign) are
 * not deliveries and are excluded; how many were excluded comes back as
 * `transferredExcluded`. Admin only.
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

  const gte = assignedAt.gte ?? null;
  const lte = assignedAt.lte ?? null;
  // A lead's CURRENT assignment came from a transfer when a reassign activity was
  // written with that assignment (same transaction → within a minute of assignedAt).
  const rows = await prisma.$queryRaw<{ total: number; transferred: number }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "LeadActivity" a
        WHERE a."leadId" = l.id
          AND a.type = 'LEAD_ASSIGNED'
          AND (a.metadata->>'transfer' = 'true' OR a.body LIKE 'Reassigned to%' OR a.body LIKE 'Bulk-reassigned to%')
          AND a."createdAt" >= l."assignedAt" - interval '1 minute'
      ))::int AS transferred
    FROM "Lead" l
    WHERE l."assignedUserId" = ${callerId}
      AND l."trashedAt" IS NULL
      AND (${gte}::timestamp IS NULL OR l."assignedAt" >= ${gte}::timestamp)
      AND (${lte}::timestamp IS NULL OR l."assignedAt" <= ${lte}::timestamp)`;
  const total = rows[0]?.total ?? 0;
  const transferred = rows[0]?.transferred ?? 0;

  return NextResponse.json({ count: total - transferred, transferredExcluded: transferred, from, to });
}
