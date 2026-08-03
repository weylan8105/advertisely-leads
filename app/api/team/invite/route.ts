import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { sendTeamInviteEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXTAUTH_URL ?? "https://advertisely.io";

/** POST /api/team/invite — body { email, role } — invite a teammate. Owner/Admin only. */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx) return NextResponse.json({ error: "No organization" }, { status: 404 });
  if (!canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only owners and admins can invite" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { email?: string; role?: string };
  const email = body.email?.toLowerCase().trim();
  const role = body.role === "ADMIN" || body.role === "AGENT" ? body.role : "AGENT";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  // Already a member of this org?
  const existingMember = await prisma.membership.findFirst({
    where: { organizationId: ctx.organizationId, user: { email: { equals: email, mode: "insensitive" } } },
  });
  if (existingMember) {
    return NextResponse.json({ error: `${email} is already on your team` }, { status: 409 });
  }

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Reuse a pending invite for the same email (refresh token + expiry) so we
  // don't pile up duplicates.
  const existingInvite = await prisma.invitation.findFirst({
    where: { organizationId: ctx.organizationId, email, status: "PENDING" },
  });
  const invite = existingInvite
    ? await prisma.invitation.update({
        where: { id: existingInvite.id },
        data: { role, expiresAt, invitedById: userId },
      })
    : await prisma.invitation.create({
        data: { organizationId: ctx.organizationId, email, role, invitedById: userId, expiresAt },
      });

  const acceptUrl = `${APP_URL}/invite/${invite.token}`;
  let emailed = false;
  if (isEmailConfigured) {
    const inviter = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    const r = await sendTeamInviteEmail({
      toEmail: email,
      orgName: ctx.organizationName,
      inviterName: inviter?.name || inviter?.email || "A teammate",
      role,
      acceptUrl,
    });
    emailed = r.success;
  }

  return NextResponse.json({
    ok: true,
    invitation: { id: invite.id, email, role, expiresAt },
    emailed,
    // Surface the link so the owner can copy it even if email isn't configured.
    acceptUrl,
  });
}
