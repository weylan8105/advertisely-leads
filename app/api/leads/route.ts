import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { serializeLead } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leads
 *
 * Returns the signed-in user's assigned leads, serialized for the CRM UI.
 * Optional query params:
 *   - status: filter by UI status label or DB enum (e.g. "New" / "NEW")
 *   - email:  ADMIN only — fetch another user's leads by their account email
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ leads: [] });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const emailParam = searchParams.get("email");

  const isAdmin = (session.user as any).role === "ADMIN";

  // Resolve whose leads to fetch.
  let targetUserId = (session.user as any).id as string;
  if (emailParam) {
    if (!isAdmin) {
      return NextResponse.json({ error: "Admin access required for email lookup" }, { status: 403 });
    }
    const target = await prisma.user.findFirst({
      where: { email: { equals: emailParam, mode: "insensitive" } },
      select: { id: true },
    });
    if (!target) {
      return NextResponse.json({ error: `No account found for "${emailParam}"` }, { status: 404 });
    }
    targetUserId = target.id;
  }

  const where: any = { assignedUserId: targetUserId };
  if (statusParam && statusParam !== "all") {
    // Accept both UI labels ("Appointment Set") and DB enums ("APPOINTMENT_SET").
    where.status = statusParam.toUpperCase().replace(/ /g, "_");
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    include: {
      assignedUser: { select: { name: true } },
      notes: { orderBy: { createdAt: "desc" } },
      tasks: true,
      activity: { orderBy: { createdAt: "desc" } },
    },
  });

  return NextResponse.json({ leads: leads.map(serializeLead) });
}
