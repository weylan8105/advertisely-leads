import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/lib/password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/account/password  { currentPassword, newPassword }
 * Change the caller's password. Credential accounts only — Google-only accounts
 * have no password to change.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const { currentPassword, newPassword } = (await req.json().catch(() => ({}))) as {
    currentPassword?: string;
    newPassword?: string;
  };
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json({ error: "New password must be at least 8 characters." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { passwordHash: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "Your account signs in with Google, so there's no password to change." },
      { status: 400 },
    );
  }

  const ok = typeof currentPassword === "string" && (await verifyPassword(currentPassword, user.passwordHash));
  if (!ok) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  await prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(newPassword) } });
  return NextResponse.json({ ok: true });
}
