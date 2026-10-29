import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { canActOnLead } from "@/lib/leadAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/draft-date  { draftDate: "YYYY-MM-DD" | null }
 * Set (or clear) the date a submitted deal's initial premium drafts. Stored at
 * noon UTC so the calendar day never shifts across US time zones.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { draftDate?: string | null };
  let draftDate: Date | null = null;
  if (body.draftDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.draftDate)) {
      return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
    }
    draftDate = new Date(`${body.draftDate}T12:00:00.000Z`);
    if (Number.isNaN(draftDate.getTime())) {
      return NextResponse.json({ error: "Pick a valid date." }, { status: 400 });
    }
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true, pipeline: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  if (!(await canActOnLead(callerId, isPlatformAdmin, lead))) {
    return NextResponse.json({ error: "You can only set the draft date on your own leads." }, { status: 403 });
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { draftDate } });
  return NextResponse.json({ ok: true, draftDate: draftDate ? draftDate.toISOString().slice(0, 10) : null });
}
