import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/leads/:id/callback — set or clear a call-back reminder.
 * Body: { callbackAt: string | null }  (ISO timestamp, or null to clear)
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";

  const body = (await req.json().catch(() => ({}))) as { callbackAt?: string | null };
  let at: Date | null = null;
  if (body.callbackAt) {
    at = new Date(body.callbackAt);
    if (isNaN(at.getTime())) return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true, name: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  let allowed = isPlatformAdmin || lead.assignedUserId === userId;
  if (!allowed && lead.organizationId) {
    const ctx = await getOrgContext(userId);
    allowed = !!ctx && ctx.organizationId === lead.organizationId && canManageTeam(ctx.role);
  }
  if (!allowed) return NextResponse.json({ error: "You can't schedule this lead" }, { status: 403 });

  await prisma.lead.update({ where: { id: params.id }, data: { callbackAt: at } });
  await prisma.leadActivity.create({
    data: {
      leadId: params.id,
      type: "NOTE_ADDED",
      body: at ? `Call-back scheduled for ${at.toLocaleString("en-US")}.` : "Call-back reminder cleared.",
    },
  });

  return NextResponse.json({ ok: true, callbackAt: at ? at.toISOString() : null });
}
