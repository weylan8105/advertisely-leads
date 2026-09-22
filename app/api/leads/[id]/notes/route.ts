import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/notes   Body: { body: string }
 *
 * Add a note to a lead. An agent can note a lead they own; a team owner/admin
 * can note any lead in their org; a platform admin can note any lead. Notes are
 * private to the agent/team who own the lead.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { body } = (await req.json().catch(() => ({}))) as { body?: string };
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return NextResponse.json({ error: "Note text is required" }, { status: 400 });
  if (text.length > 5000) return NextResponse.json({ error: "Note is too long (5000 char max)." }, { status: 400 });

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // Authorization: own the lead, manage its org, or be a platform admin.
  const ownsLead = lead.assignedUserId === callerId;
  let managesOrg = false;
  if (!ownsLead && !isPlatformAdmin) {
    const ctx = await ensureOrgContext(callerId);
    managesOrg = !!ctx && canManageTeam(ctx.role) && !!lead.organizationId && lead.organizationId === ctx.organizationId;
  }
  if (!ownsLead && !managesOrg && !isPlatformAdmin) {
    return NextResponse.json({ error: "You can only add notes to your own leads." }, { status: 403 });
  }

  const author = session?.user?.name || session?.user?.email || "Agent";
  const note = await prisma.leadNote.create({
    data: { leadId: lead.id, author, body: text },
  });
  await prisma.leadActivity.create({
    data: { leadId: lead.id, type: "NOTE_ADDED", author, body: text.slice(0, 280) },
  });

  return NextResponse.json({
    ok: true,
    note: { id: note.id, author: note.author, body: note.body, at: note.createdAt.toISOString() },
  });
}
