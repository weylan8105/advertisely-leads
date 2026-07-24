import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { leadsToCsv, LEAD_CSV_SELECT } from "@/lib/csv";
import { leadPackages } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/client-leads?email=<client email>[&format=csv][&status=<LeadStatus>]
 *
 * Admin-only. Looks up a client by the email they signed up with and returns
 * their account, every order they've placed (including the states they
 * purchased), and the leads that have actually been delivered to them.
 *
 * - format=json (default) → structured summary + full lead records as JSON.
 * - format=csv            → downloadable CSV of that client's delivered leads,
 *                           ready to hand off.
 *
 * Requires ADMIN role.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email")?.trim();
  const format = (searchParams.get("format") ?? "json").toLowerCase();
  const statusParam = searchParams.get("status");

  if (!email) {
    return NextResponse.json(
      { error: "email query parameter is required" },
      { status: 400 },
    );
  }

  // Case-insensitive match so "Client@Gmail.com" still resolves.
  const client = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      email: true,
      agency: true,
      role: true,
      state: true,
      createdAt: true,
    },
  });

  if (!client) {
    return NextResponse.json(
      { error: `No account found for email "${email}"` },
      { status: 404 },
    );
  }

  // All orders this client has placed.
  const orders = await prisma.order.findMany({
    where: { userId: client.id },
    orderBy: { createdAt: "desc" },
  });

  // The leads actually delivered (assigned) to this client.
  const leadWhere: any = { assignedUserId: client.id };
  if (statusParam && statusParam !== "all") {
    leadWhere.status = statusParam.toUpperCase();
  }
  const leads = await prisma.lead.findMany({
    where: leadWhere,
    orderBy: { assignedAt: "desc" },
    select: LEAD_CSV_SELECT,
  });

  // ── CSV branch: stream the delivered leads for hand-off ──────────────
  if (format === "csv") {
    const csv = leadsToCsv(leads);
    const safeEmail = client.email.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filename = `advertisely-leads-${safeEmail}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── JSON branch: structured summary ──────────────────────────────────
  const packageName = (id: string) =>
    leadPackages.find((p) => p.id === id)?.name ?? id;

  const purchasedStates = Array.from(
    new Set(orders.flatMap((o) => o.filterStates)),
  ).sort();

  const summary = {
    totalOrders: orders.length,
    totalLeadsPurchased: orders.reduce((sum, o) => sum + o.quantity, 0),
    totalLeadsDelivered: leads.length,
    lifetimeSpendCents: orders.reduce((sum, o) => sum + o.totalCents, 0),
    purchasedStates,
  };

  return NextResponse.json({
    client,
    summary,
    orders: orders.map((o) => ({
      id: o.id,
      package: packageName(o.packageId),
      packageId: o.packageId,
      quantity: o.quantity,
      fulfilledCount: o.fulfilledCount,
      status: o.status,
      filterStates: o.filterStates,
      filterIncomeMin: o.filterIncomeMin,
      pricePerLeadCents: o.pricePerLeadCents,
      totalCents: o.totalCents,
      stripePaymentIntentId: o.stripePaymentIntentId,
      createdAt: o.createdAt,
      fulfilledAt: o.fulfilledAt,
    })),
    leads,
  });
}
