import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getAdSpendSummary, enforceAdSpend, MANUAL_PAYMENT_METHODS } from "@/lib/adSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function adminId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as any;
  return u?.role === "ADMIN" ? String(u.id ?? u.email ?? "admin") : null;
}

/**
 * POST /api/admin/ad-spend/payments { userId, amountCents, method, note?, receivedAt? } —
 * record ad-spend money a client sent outside Stripe (Zelle, check, wire, cash).
 * It's added to their budget in full (no card fee) and their campaign caps are re-applied.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const by = await adminId();
  if (!by) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    userId?: string; amountCents?: number; method?: string; note?: string; receivedAt?: string;
  };
  const amountCents = Math.round(Number(body.amountCents));
  const method = String(body.method ?? "").toLowerCase();
  if (!body.userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
  if (!Number.isFinite(amountCents) || amountCents === 0 || Math.abs(amountCents) > 10_000_000) {
    return NextResponse.json({ error: "amountCents must be a non-zero amount up to $100,000 (negative to correct)." }, { status: 400 });
  }
  if (!(MANUAL_PAYMENT_METHODS as readonly string[]).includes(method)) {
    return NextResponse.json({ error: `method must be one of ${MANUAL_PAYMENT_METHODS.join(", ")}.` }, { status: 400 });
  }
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime())) return NextResponse.json({ error: "receivedAt isn't a date." }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "No such user." }, { status: 404 });

  const payment = await prisma.adSpendPayment.create({
    data: { userId: user.id, amountCents, method, note: body.note?.trim() || null, receivedAt, createdById: by },
  });
  const result = await enforceAdSpend(user.id);
  return NextResponse.json({ payment, result, summary: await getAdSpendSummary(user.id, { fresh: true }) });
}

/** DELETE /api/admin/ad-spend/payments?id=… — remove a payment recorded by mistake. */
export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!(await adminId())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required." }, { status: 400 });
  const payment = await prisma.adSpendPayment.delete({ where: { id } }).catch(() => null);
  if (!payment) return NextResponse.json({ error: "No such payment." }, { status: 404 });
  const result = await enforceAdSpend(payment.userId);
  return NextResponse.json({ deleted: id, result, summary: await getAdSpendSummary(payment.userId, { fresh: true }) });
}
