import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { serializeLead } from "@/lib/serialize";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

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
  const myId = (session.user as any).id as string;
  // Owners/admins can narrow the team view to one agent.
  const agentParam = searchParams.get("agent");

  const where: any = {};
  if (statusParam && statusParam !== "all") {
    // Accept both UI labels ("Appointment Set") and DB enums ("APPOINTMENT_SET").
    where.status = statusParam.toUpperCase().replace(/ /g, "_");
  }

  if (emailParam) {
    // Platform ADMIN: fetch a specific user's leads by email (support tooling).
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
    where.assignedUserId = target.id;
  } else {
    // Team scoping: owners/admins see the whole org; agents see only their own.
    const ctx = await ensureOrgContext(myId);
    if (ctx && canManageTeam(ctx.role)) {
      if (agentParam) {
        where.organizationId = ctx.organizationId;
        where.assignedUserId = agentParam;
      } else {
        // Whole org PLUS any lead assigned directly to them — so leads that were
        // assigned without an org stamp still show up for their owner.
        where.OR = [{ organizationId: ctx.organizationId }, { assignedUserId: myId }];
      }
    } else {
      where.assignedUserId = myId;
    }
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
