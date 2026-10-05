import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/value  { valueCents: number | null }
 * Set (or clear) the opportunity value on a lead. An agent can value a lead they
 * own; a team owner/admin any lead in their org; a platform admin any lead.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { valueCents?: number | null };
  let valueCents: number | null = null;
  if (body.valueCents != null) {
    const n = Math.round(Number(body.valueCents));
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "Enter a valid dollar amount." }, { status: 400 });
    }
    valueCents = Math.min(n, 1_000_000_00); // cap at $1,000,000 to avoid typos
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const ownsLead = lead.assignedUserId === callerId;
  let managesOrg = false;
  if (!ownsLead && !isPlatformAdmin) {
    const ctx = await ensureOrgContext(callerId);
    managesOrg = !!ctx && canManageTeam(ctx.role) && !!lead.organizationId && lead.organizationId === ctx.organizationId;
  }
  if (!ownsLead && !managesOrg && !isPlatformAdmin) {
    return NextResponse.json({ error: "You can only set the value on your own leads." }, { status: 403 });
  }

  await prisma.lead.update({ where: { id: lead.id }, data: { valueCents } });
  return NextResponse.json({ ok: true, valueCents });
}
