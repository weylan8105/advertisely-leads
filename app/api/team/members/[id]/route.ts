import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { uplineCampaignFundable } from "@/lib/teamAdvertiser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(membershipId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return { error: "Unauthorized", status: 401 as const };
  const ctx = await ensureOrgContext(userId);
  if (!ctx) return { error: "No organization", status: 404 as const };
  if (!canManageTeam(ctx.role)) return { error: "Only owners and admins can manage members", status: 403 as const };

  const membership = await prisma!.membership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.organizationId !== ctx.organizationId) {
    return { error: "Member not found", status: 404 as const };
  }
  if (membership.role === "OWNER") {
    return { error: "The team owner can't be modified", status: 400 as const };
  }
  return { ctx, membership, userId };
}

/**
 * PATCH /api/team/members/:id — { role?, goldmineAccess?, adSpendAccess? }
 * adSpendAccess = on an advertiser's team, let this member add spend to the
 * owner's campaign for campaign leads (lib/teamAdSpend.ts; off by default).
 * goldmineAccess = switch the member's access to the team's Goldmine (on by
 * default).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const g = await guard(params.id);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });

  const body = (await req.json().catch(() => ({}))) as {
    role?: string;
    goldmineAccess?: boolean;
    adSpendAccess?: boolean;
  };
  const data: { role?: "ADMIN" | "AGENT"; goldmineBlocked?: boolean; adSpendAccess?: boolean } = {};
  if (body.role === "ADMIN" || body.role === "AGENT") data.role = body.role;
  if (typeof body.goldmineAccess === "boolean") data.goldmineBlocked = !body.goldmineAccess;
  if (typeof body.adSpendAccess === "boolean") data.adSpendAccess = body.adSpendAccess;
  // Can't be switched on where the owner has no campaign of their own: the
  // member's money could never buy a lead there (lib/teamAdvertiser.ts).
  if (data.adSpendAccess === true) {
    const org = await prisma.organization.findUnique({
      where: { id: g.membership.organizationId },
      select: { owner: { select: { email: true, isAdvertiser: true, adCampaignIds: true } } },
    });
    if (!uplineCampaignFundable(org?.owner)) {
      return NextResponse.json(
        { error: "This team has no campaign of its own for members to add spend to. Members add ad spend to their own account from their dashboard." },
        { status: 409 },
      );
    }
  }
  // Admins help run the team, so becoming one turns Goldmine on (it can be switched off after).
  if (data.role === "ADMIN" && data.goldmineBlocked === undefined) data.goldmineBlocked = false;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await prisma.membership.update({ where: { id: params.id }, data });
  return NextResponse.json({
    ok: true,
    membership: {
      id: updated.id,
      role: updated.role,
      goldmineAccess: !updated.goldmineBlocked,
      adSpendAccess: updated.adSpendAccess,
    },
  });
}

/** DELETE /api/team/members/:id — remove a seat; their active leads revert to the owner. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const g = await guard(params.id);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });

  const { ctx, membership } = g;
  const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { ownerId: true } });

  await prisma.$transaction(async (tx) => {
    // Revert the removed member's org leads to the owner so nothing is orphaned.
    if (org?.ownerId) {
      await tx.lead.updateMany({
        where: { organizationId: ctx.organizationId, assignedUserId: membership.userId },
        data: { assignedUserId: org.ownerId },
      });
    }
    await tx.membership.delete({ where: { id: membership.id } });
  });

  return NextResponse.json({ ok: true });
}
