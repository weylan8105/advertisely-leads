import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { serializeLead } from "@/lib/serialize";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { sweepGoldmineForOrg } from "@/lib/goldmine";

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
  // "main" (default) = the agent's own board; "goldmine" = the team-shared
  // aged-lead pool that every org member can work.
  const pipelineParam = searchParams.get("pipeline") === "goldmine" ? "goldmine" : "main";

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
    // Mirror what that user sees on their own board (Goldmine leads excluded).
    where.pipeline = "main";
  } else if (pipelineParam === "goldmine") {
    // Goldmine is a team-shared pool: every member of the org sees the same
    // aged leads and can work them. No per-agent narrowing.
    const ctx = await ensureOrgContext(myId);
    if (!ctx) return NextResponse.json({ leads: [] });
    // Move anything that just aged out before listing (throttled; cron is the backstop).
    await sweepGoldmineForOrg(ctx.organizationId);
    where.organizationId = ctx.organizationId;
    where.pipeline = "goldmine";
  } else {
    // Each person's CRM shows only THEIR OWN assigned leads — a lead lives in
    // exactly one agent's list, so an upline and a downline agent never both see
    // the same lead. An owner/admin can view a specific downline agent's leads
    // with ?agent=<id> (a read-only team overview), or the whole org with
    // ?scope=org (used by team-overview tooling), but the default is always mine.
    const ctx = await ensureOrgContext(myId);
    // Aged leads leave the board as soon as they qualify, not at the nightly run.
    if (ctx) await sweepGoldmineForOrg(ctx.organizationId);
    const scopeParam = searchParams.get("scope");
    const canManage = !!ctx && canManageTeam(ctx.role);
    if (canManage && agentParam) {
      where.organizationId = ctx!.organizationId;
      where.assignedUserId = agentParam;
    } else if (canManage && scopeParam === "org") {
      where.OR = [{ organizationId: ctx!.organizationId }, { assignedUserId: myId }];
    } else {
      where.assignedUserId = myId;
    }
    // The main board never shows leads that have dropped into Goldmine.
    where.pipeline = "main";
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
