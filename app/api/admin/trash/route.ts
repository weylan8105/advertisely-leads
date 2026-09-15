import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { emptyTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin recycle-bin.
 *   GET  /api/admin/trash  — list trashed leads (newest first) + retention info.
 *   POST /api/admin/trash  — { action: "empty" }  purge leads past retention now.
 *                            { action: "restore", leadId } untrash one lead
 *                            (returns it to the pool as available inventory).
 * Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ leads: [], retentionDays: TRASH_RETENTION_DAYS });
  }

  const leads = await prisma.lead.findMany({
    where: { trashedAt: { not: null } },
    orderBy: { trashedAt: "desc" },
    select: {
      id: true, name: true, phone: true, email: true, state: true, occupation: true,
      packageId: true, status: true, disposition: true, trashedAt: true, orderId: true,
    },
  });

  const now = Date.now();
  const withCountdown = leads.map((l) => ({
    ...l,
    deletesInDays: l.trashedAt
      ? Math.max(0, TRASH_RETENTION_DAYS - Math.floor((now - new Date(l.trashedAt).getTime()) / 86_400_000))
      : null,
  }));

  return NextResponse.json({ leads: withCountdown, count: leads.length, retentionDays: TRASH_RETENTION_DAYS });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const db = prisma;

  const body = (await req.json().catch(() => ({}))) as { action?: string; leadId?: string };

  if (body.action === "empty") {
    const purged = await emptyTrash(TRASH_RETENTION_DAYS);
    return NextResponse.json({ ok: true, purged, retentionDays: TRASH_RETENTION_DAYS });
  }

  if (body.action === "restore") {
    if (!body.leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });
    // Untrash → return to the pool as available inventory (unassigned, no order).
    await db.lead.update({
      where: { id: body.leadId },
      data: { trashedAt: null, status: "NEW", pipelineStage: "new-lead", disposition: null, orderId: null, assignedUserId: null },
    });
    await db.leadActivity.create({
      data: { leadId: body.leadId, type: "STATUS_CHANGED", author: "Advertisely", body: "Restored from Trash to the available pool." },
    });
    return NextResponse.json({ ok: true, restored: body.leadId });
  }

  return NextResponse.json({ error: "Unknown action. Use 'empty' or 'restore'." }, { status: 400 });
}
