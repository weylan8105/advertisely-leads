import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { sendLeadDeliveryEmail, isEmailConfigured } from "@/lib/email";
import { findPackage } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/orders/:id/route-to   Body: { userId: string | null }
 *
 * Route an order to a downline agent: existing leads on the order move to that
 * agent, and future deliveries for the order go straight to them too
 * (deliverToUserId). userId:null clears the routing (future leads go back to the
 * buyer; already-moved leads stay where they are). Only the order's buyer, an
 * org owner/admin, or a platform admin may route, and the target must be a
 * member of the buyer's organization.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { userId?: string | null };
  const targetUserId =
    body.userId === null ? null : typeof body.userId === "string" && body.userId ? body.userId : undefined;
  if (targetUserId === undefined) {
    return NextResponse.json({ error: "userId is required (or null to clear routing)" }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, organizationId: true, packageId: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Authorization: buyer, org manager of the order's org, or platform admin.
  const ctx = await ensureOrgContext(callerId);
  const isBuyer = order.userId === callerId;
  const managesOrg =
    !!ctx && canManageTeam(ctx.role) && !!order.organizationId && order.organizationId === ctx.organizationId;
  if (!isBuyer && !managesOrg && !isPlatformAdmin) {
    return NextResponse.json({ error: "You can't route this order." }, { status: 403 });
  }

  const orgId = order.organizationId ?? ctx?.organizationId ?? null;

  // Validate the target agent is in the order's organization (unless clearing).
  let targetName: string | null = null;
  if (targetUserId) {
    if (!isPlatformAdmin) {
      const member = orgId
        ? await prisma.membership.findUnique({
            where: { organizationId_userId: { organizationId: orgId, userId: targetUserId } },
            select: { id: true },
          })
        : null;
      if (!member) {
        return NextResponse.json({ error: "That agent isn't on this order's team." }, { status: 400 });
      }
    }
    const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    targetName = u?.name ?? null;
  }

  // Point future deliveries at the agent (or clear).
  await prisma.order.update({ where: { id: order.id }, data: { deliverToUserId: targetUserId } });

  // Move the order's existing (non-trashed) leads to the agent now.
  let moved = 0;
  let movedLeads: Array<{ name: string; phone: string; email: string; state: string; occupation: string | null; age: number | null; income: number | null; intentReason: string | null }> = [];
  if (targetUserId) {
    const existing = await prisma.lead.findMany({
      where: { orderId: order.id, trashedAt: null, assignedUserId: { not: targetUserId } },
      select: { id: true, name: true, phone: true, email: true, state: true, occupation: true, age: true, income: true, intentReason: true },
    });
    if (existing.length > 0) {
      const now = new Date();
      await prisma.lead.updateMany({
        where: { id: { in: existing.map((l) => l.id) } },
        data: { assignedUserId: targetUserId, assignedAt: now, ...(orgId ? { organizationId: orgId } : {}) },
      });
      await prisma.leadActivity.createMany({
        data: existing.map((l) => ({ leadId: l.id, type: "LEAD_ASSIGNED" as const, author: session?.user?.name ?? "Owner", body: `Routed to ${targetName ?? "a team agent"} (order ${order.id}).` })),
      });
      moved = existing.length;
      movedLeads = existing.map((l) => ({ name: l.name, phone: l.phone, email: l.email, state: l.state, occupation: l.occupation, age: l.age, income: l.income, intentReason: l.intentReason }));
    }
  }

  // Email the agent exactly the leads that just moved to them (accurate to CRM).
  let emailed = false;
  if (targetUserId && movedLeads.length > 0 && isEmailConfigured) {
    try {
      const agent = await prisma.user.findUnique({ where: { id: targetUserId }, select: { email: true, name: true } });
      if (agent?.email) {
        await sendLeadDeliveryEmail({
          agentEmail: agent.email,
          agentName: agent.name ?? "Agent",
          leadCount: movedLeads.length,
          packageName: findPackage(order.packageId)?.name ?? order.packageId,
          orderId: order.id,
          leads: movedLeads.slice(0, 50),
        });
        emailed = true;
      }
    } catch (e) {
      console.warn("Routing email failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    deliverToUserId: targetUserId,
    routedToName: targetName,
    movedExisting: moved,
    emailed,
  });
}
