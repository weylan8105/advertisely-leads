import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") return null;
  return session;
}

/** GET /api/admin/house-settlements — recent settlements with the admin's name. */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ settlements: [] });
  try {
    const rows = await prisma.houseLeadSettlement.findMany({
      orderBy: [{ periodStart: "desc" }, { amountCents: "desc" }],
      take: 40,
      include: { user: { select: { name: true, email: true } } },
    });
    return NextResponse.json({
      settlements: rows.map((s) => ({
        id: s.id, name: s.user?.name ?? s.user?.email ?? "—", email: s.user?.email ?? "",
        periodStart: s.periodStart, periodEnd: s.periodEnd, leadCount: s.leadCount,
        cplCents: s.cplCents, amountCents: s.amountCents, status: s.status, paidAt: s.paidAt,
      })),
    });
  } catch {
    // Table not migrated yet.
    return NextResponse.json({ settlements: [], note: "Settlement table not set up yet." });
  }
}

/** PATCH /api/admin/house-settlements — mark a settlement paid or unpaid. Body: { id, status } */
export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { id?: string; status?: string };
  if (!body.id || (body.status !== "PAID" && body.status !== "PENDING")) {
    return NextResponse.json({ error: "id and status (PAID|PENDING) required" }, { status: 400 });
  }
  try {
    const updated = await prisma.houseLeadSettlement.update({
      where: { id: body.id },
      data: { status: body.status, paidAt: body.status === "PAID" ? new Date() : null },
      select: { id: true, status: true, paidAt: true, amountCents: true },
    });
    return NextResponse.json({ ok: true, settlement: updated });
  } catch {
    return NextResponse.json({ error: "Settlement not found or table not set up." }, { status: 404 });
  }
}
