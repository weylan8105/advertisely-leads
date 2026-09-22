import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/account/phone  → { phone: string | null }  (the caller's own phone)
 * POST /api/account/phone  { phone } → { ok, phone }    (set the caller's phone)
 *
 * Powers the "add your phone number" prompt shown to existing clients whose
 * account predates phone collection at signup.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  return NextResponse.json({ phone: user?.phone ?? null });
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { phone?: unknown };
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (phone.replace(/\D/g, "").length < 10) {
    return NextResponse.json({ error: "Enter a valid phone number (at least 10 digits)." }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: { phone } });
  return NextResponse.json({ ok: true, phone });
}
