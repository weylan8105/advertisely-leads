import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { leadPackages } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  NEW: "New", CONTACTED: "Contacted", APPOINTMENT_SET: "Appointment Set",
  NO_ANSWER: "No Answer", BAD_NUMBER: "Bad Number", CLOSED: "Closed", REPLACED: "Replaced",
};

/**
 * GET /api/admin/leads
 *
 * Full database view for admins — every lead, regardless of assignment.
 * Query params (all optional):
 *   assigned = all | assigned | unassigned
 *   state, packageId, source, status, search, limit
 *
 * Returns leads + total counts so the admin can trust what's in the DB.
 * Requires ADMIN role.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ leads: [], counts: { total: 0, assigned: 0, unassigned: 0 } });
  }

  const { searchParams } = new URL(req.url);
  const assigned = searchParams.get("assigned") ?? "all";
  const state = searchParams.get("state");
  const packageId = searchParams.get("packageId");
  const source = searchParams.get("source");
  const status = searchParams.get("status");
  const search = searchParams.get("search")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10) || 200, 1000);

  const where: any = {};
  if (assigned === "assigned") where.assignedUserId = { not: null };
  if (assigned === "unassigned") where.assignedUserId = null;
  if (state && state !== "all") where.state = state.toUpperCase();
  if (packageId && packageId !== "all") where.packageId = packageId;
  if (source && source !== "all") where.source = source;
  if (status && status !== "all") where.status = status.toUpperCase().replace(/ /g, "_");
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const [rows, total, assignedCount] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
      include: { assignedUser: { select: { name: true, email: true } } },
    }),
    prisma.lead.count(),
    prisma.lead.count({ where: { assignedUserId: { not: null } } }),
  ]);

  const pkgName = (id: string) => leadPackages.find((p) => p.id === id)?.name ?? id;

  const leads = rows.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    state: l.state,
    occupation: l.occupation,
    income: l.income,
    packageId: l.packageId,
    packageName: pkgName(l.packageId),
    status: STATUS_LABEL[l.status] ?? l.status,
    source: l.source,
    receivedAt: l.receivedAt,
    orderId: l.orderId,
    assignedTo: l.assignedUser ? { name: l.assignedUser.name, email: l.assignedUser.email } : null,
  }));

  // Distinct sources for the filter dropdown.
  const sources = Array.from(new Set(rows.map((l) => l.source))).sort();

  return NextResponse.json({
    leads,
    matched: leads.length,
    counts: { total, assigned: assignedCount, unassigned: total - assignedCount },
    sources,
  });
}
