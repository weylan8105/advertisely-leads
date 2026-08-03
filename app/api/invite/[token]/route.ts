import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadInvite(token: string) {
  if (!prisma) return null;
  return prisma.invitation.findUnique({
    where: { token },
    include: { organization: { select: { id: true, name: true } } },
  });
}

/** GET /api/invite/:token — public invite details for the accept page. */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const invite = await loadInvite(params.token);
  if (!invite) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });

  const expired = invite.expiresAt.getTime() < Date.now();
  return NextResponse.json({
    email: invite.email,
    role: invite.role,
    status: invite.status,
    orgName: invite.organization.name,
    expired,
    valid: invite.status === "PENDING" && !expired,
  });
}

/** POST /api/invite/:token — accept the invite (must be signed in with the invited email). */
export async function POST(_req: NextRequest, { params }: { params: { token: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  const sessionEmail = (session?.user?.email ?? "").toLowerCase();
  if (!userId) return NextResponse.json({ error: "Sign in to accept this invitation" }, { status: 401 });

  const invite = await loadInvite(params.token);
  if (!invite) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invite.status !== "PENDING") {
    return NextResponse.json({ error: `This invitation is ${invite.status.toLowerCase()}` }, { status: 409 });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    await prisma.invitation.update({ where: { id: invite.id }, data: { status: "EXPIRED" } });
    return NextResponse.json({ error: "This invitation has expired" }, { status: 410 });
  }
  if (sessionEmail !== invite.email.toLowerCase()) {
    return NextResponse.json(
      { error: `This invite was sent to ${invite.email}. Sign in with that email to accept.` },
      { status: 403 },
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.upsert({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId } },
      update: { role: invite.role },
      create: { organizationId: invite.organizationId, userId, role: invite.role, inRotation: true },
    });
    await tx.invitation.update({
      where: { id: invite.id },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
    });
    // Switch the user's active context to the team they just joined.
    await tx.user.update({ where: { id: userId }, data: { defaultOrganizationId: invite.organizationId } });
  });

  return NextResponse.json({ ok: true, organization: { id: invite.organization.id, name: invite.organization.name } });
}
