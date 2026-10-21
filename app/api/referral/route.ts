import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { ensureReferralCode, isAdminRole } from "@/lib/referral";
import { normalizeCode, CODE_PATTERN } from "@/lib/referralPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function me() {
  if (!REFERRAL_PROGRAM_ENABLED) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (!isDatabaseConfigured || !prisma) return { error: NextResponse.json({ error: "Database not configured" }, { status: 503 }) };
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user: user as { id: string; role?: string } };
}

/**
 * GET /api/referral — the caller's code, Bucks balance and recent history.
 * Referral program draft; 404 while the flag is off.
 */
export async function GET() {
  const auth = await me();
  if (auth.error) return auth.error;
  const code = await ensureReferralCode(auth.user.id);
  const [u, history, referredOrders] = await Promise.all([
    prisma!.user.findUnique({ where: { id: auth.user.id }, select: { bucksCents: true } }),
    prisma!.bucksTransaction.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, amountCents: true, kind: true, note: true, createdAt: true },
    }),
    prisma!.order.count({ where: { referrerUserId: auth.user.id } }),
  ]);
  const admin = isAdminRole(auth.user.role);
  return NextResponse.json({
    code,
    // Admins can't earn or spend Bucks.
    bucksEnabled: !admin,
    bucksCents: admin ? 0 : u?.bucksCents ?? 0,
    referredOrders,
    history: admin ? [] : history,
  });
}

/** PATCH /api/referral { code } — change your code (4–20 letters/digits, unique). */
export async function PATCH(req: NextRequest) {
  const auth = await me();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const code = normalizeCode(String(body.code ?? ""));
  if (!CODE_PATTERN.test(code)) {
    return NextResponse.json({ error: "Codes are 4–20 letters or numbers, no spaces." }, { status: 400 });
  }
  try {
    await prisma!.user.update({ where: { id: auth.user.id }, data: { referralCode: code } });
  } catch (e: any) {
    if (e?.code === "P2002") return NextResponse.json({ error: "That code is taken — try another." }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ ok: true, code });
}
