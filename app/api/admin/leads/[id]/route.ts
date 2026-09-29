import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { serializeLead } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/leads/:id
 *
 * Full detail for a single lead, for the admin leads-database view — so an admin
 * can open any lead's card (all captured form data, quiz answers, consent, notes)
 * regardless of whether it has been sold into an agent's CRM.
 *
 * Requires ADMIN role.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      assignedUser: { select: { name: true } },
      notes: { orderBy: { createdAt: "desc" } },
      tasks: true,
      activity: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  return NextResponse.json({ lead: serializeLead(lead) });
}
