import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getHouseAccount } from "@/lib/house";
import { buildLeadCostLedger, forgetLeadCostLedger, setLeadBillingMode, LEAD_COST_PAYMENT_METHOD } from "@/lib/leadCostLedger";
import { isOwnerEmail } from "@/lib/owners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// What the admins owe for the leads routed to them: owner-only (Ryan + Weylan).
async function requireOwner() {
  const session = await getServerSession(authOptions);
  const u = session?.user as { email?: string; role?: string; id?: string } | undefined;
  if (!u?.email || u.role !== "ADMIN" || !isOwnerEmail(u.email)) return null;
  return u;
}

/** GET /api/admin/lead-cost — the admin lead balance (owed vs paid). */
export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ ledger: null });
  const ledger = await buildLeadCostLedger().catch(() => null);
  return NextResponse.json({ ledger });
}

/**
 * POST /api/admin/lead-cost — record a bank transfer an admin paid toward the leads.
 * Body: { amountCents, note? }. No verification — we trust the amount he enters.
 * Always recorded against the house account (Ryan), regardless of who logs it.
 */
export async function POST(req: NextRequest) {
  const by = await requireOwner();
  if (!by) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const house = await getHouseAccount();
  if (!house) return NextResponse.json({ error: "House account not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { amountCents?: number; note?: string };
  const amountCents = Math.round(Number(body.amountCents));
  if (!Number.isFinite(amountCents) || amountCents === 0 || Math.abs(amountCents) > 10_000_000) {
    return NextResponse.json({ error: "Enter an amount up to $100,000 (use a negative amount to correct a mistake)." }, { status: 400 });
  }

  await prisma.adSpendPayment.create({
    data: {
      userId: house.userId,
      amountCents,
      method: LEAD_COST_PAYMENT_METHOD,
      note: body.note?.trim() || "Admin lead balance bank transfer",
      receivedAt: new Date(),
      createdById: String(by.id ?? by.email ?? "owner"),
    },
  });

  forgetLeadCostLedger();
  const ledger = await buildLeadCostLedger(new Date(), { fresh: true }).catch(() => null);
  return NextResponse.json({ ok: true, ledger });
}

/**
 * PATCH /api/admin/lead-cost — choose how the admins pay for their leads.
 * Body: { mode: "advance" | "prepay" }. "advance" = leads first, pay after;
 * "prepay" = pay first, and leads only arrive while the balance covers them.
 */
export async function PATCH(req: NextRequest) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { mode?: string };
  if (body.mode !== "advance" && body.mode !== "prepay") {
    return NextResponse.json({ error: "Choose leads first or pay first." }, { status: 400 });
  }
  await setLeadBillingMode(body.mode);
  const ledger = await buildLeadCostLedger().catch(() => null);
  return NextResponse.json({ ok: true, ledger });
}

/** DELETE /api/admin/lead-cost?id=… — remove a payment logged by mistake. */
export async function DELETE(req: NextRequest) {
  const by = await requireOwner();
  if (!by) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  // Only remove lead-cost (bank) payments, never advertiser Stripe/manual ones.
  const pay = await prisma.adSpendPayment.findUnique({ where: { id }, select: { method: true } });
  if (!pay || pay.method !== LEAD_COST_PAYMENT_METHOD) return NextResponse.json({ error: "No such payment" }, { status: 404 });
  await prisma.adSpendPayment.delete({ where: { id } });
  forgetLeadCostLedger();
  const ledger = await buildLeadCostLedger(new Date(), { fresh: true }).catch(() => null);
  return NextResponse.json({ ok: true, ledger });
}
