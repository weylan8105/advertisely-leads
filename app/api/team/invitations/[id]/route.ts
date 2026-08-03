import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DELETE /api/team/invitations/:id — revoke a pending invite. Owner/Admin only. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx) return NextResponse.json({ error: "No organization" }, { status: 404 });
  if (!canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only owners and admins can revoke invites" }, { status: 403 });
  }

  const invite = await prisma.invitation.findUnique({ where: { id: params.id } });
  if (!invite || invite.organizationId !== ctx.organizationId) {
    return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  }

  await prisma.invitation.update({ where: { id: params.id }, data: { status: "REVOKED" } });
  return NextResponse.json({ ok: true });
}
