import { NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Account signups aren't available yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email =
    typeof data.email === "string" ? data.email.toLowerCase().trim() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const agency = typeof data.agency === "string" ? data.agency.trim() : "";
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";
  const inviteToken = typeof data.inviteToken === "string" ? data.inviteToken.trim() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (phone.replace(/\D/g, "").length < 10) {
    return NextResponse.json(
      { error: "Enter a valid phone number (at least 10 digits)." },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Try signing in." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      name: name || null,
      agency: agency || null,
      phone: phone || null,
      passwordHash,
    },
    select: { id: true },
  });

  // If this signup came from a valid downline invite for THIS email, join the
  // new agent to the inviter's organization (their upline) immediately, so
  // "invite an agent → they create an account in your downline" works in one step.
  let joinedTeam = false;
  if (inviteToken) {
    const invite = await prisma.invitation.findUnique({ where: { token: inviteToken } });
    if (
      invite &&
      invite.status === "PENDING" &&
      invite.expiresAt > new Date() &&
      invite.email.toLowerCase() === email
    ) {
      await prisma.$transaction([
        prisma.membership.upsert({
          where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.id } },
          update: {},
          create: { organizationId: invite.organizationId, userId: user.id, role: invite.role, inRotation: true },
        }),
        prisma.invitation.update({ where: { id: invite.id }, data: { status: "ACCEPTED", acceptedAt: new Date() } }),
        prisma.user.update({ where: { id: user.id }, data: { defaultOrganizationId: invite.organizationId } }),
      ]);
      joinedTeam = true;
    }
  }

  return NextResponse.json({ ok: true, joinedTeam }, { status: 201 });
}
