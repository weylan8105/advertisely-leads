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
  const campaign = searchParams.get("campaign");
  const occupation = searchParams.get("occupation");
  const status = searchParams.get("status");
  const dateFrom = searchParams.get("dateFrom"); // YYYY-MM-DD (lead generated on/after)
  const dateTo = searchParams.get("dateTo"); // YYYY-MM-DD (lead generated on/before)
  const ageMin = searchParams.get("ageMin"); // prospect age
  const ageMax = searchParams.get("ageMax");
  const incomeMin = searchParams.get("incomeMin");
  const search = searchParams.get("search")?.trim();
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "200", 10) || 200, 1000);

  const where: any = {};
  // "In a CRM" = assigned to someone; "Not in a CRM" = still in the raw pool.
  if (assigned === "assigned") where.assignedUserId = { not: null };
  if (assigned === "unassigned") where.assignedUserId = null;
  if (state && state !== "all") where.state = state.toUpperCase();
  if (packageId && packageId !== "all") where.packageId = packageId;
  if (source && source !== "all") where.source = source;
  if (campaign && campaign !== "all") where.campaignName = campaign;
  if (occupation && occupation !== "all") where.occupation = occupation;
  if (status && status !== "all") where.status = status.toUpperCase().replace(/ /g, "_");

  // Date generated (receivedAt) range — inclusive of the whole end day.
  const receivedAt: { gte?: Date; lte?: Date } = {};
  if (dateFrom) { const d = new Date(dateFrom); if (!isNaN(d.getTime())) receivedAt.gte = d; }
  if (dateTo) { const d = new Date(dateTo); if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); receivedAt.lte = d; } }
  if (receivedAt.gte || receivedAt.lte) where.receivedAt = receivedAt;

  // Prospect age range + income floor.
  const ageF: { gte?: number; lte?: number } = {};
  if (ageMin) { const n = parseInt(ageMin, 10); if (!isNaN(n)) ageF.gte = n; }
  if (ageMax) { const n = parseInt(ageMax, 10); if (!isNaN(n)) ageF.lte = n; }
  if (ageF.gte != null || ageF.lte != null) where.age = ageF;
  if (incomeMin) { const n = parseInt(incomeMin, 10); if (!isNaN(n)) where.income = { gte: n }; }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
    ];
  }

  const [rows, total, assignedCount, matchedCount, srcRows, campRows, occRows] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      take: limit,
      include: { assignedUser: { select: { name: true, email: true } } },
    }),
    prisma.lead.count(),
    prisma.lead.count({ where: { assignedUserId: { not: null } } }),
    prisma.lead.count({ where }), // how many match the current filters (may exceed the page)
    // Distinct filter options across the WHOLE database (not just this page).
    prisma.lead.findMany({ distinct: ["source"], select: { source: true } }),
    prisma.lead.findMany({ distinct: ["campaignName"], select: { campaignName: true } }),
    prisma.lead.findMany({ distinct: ["occupation"], select: { occupation: true } }),
  ]);

  const pkgName = (id: string) => leadPackages.find((p) => p.id === id)?.name ?? id;

  const leads = rows.map((l) => ({
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    state: l.state,
    age: l.age,
    occupation: l.occupation,
    income: l.income,
    packageId: l.packageId,
    packageName: pkgName(l.packageId),
    status: STATUS_LABEL[l.status] ?? l.status,
    source: l.source,
    campaignName: l.campaignName,
    receivedAt: l.receivedAt,
    orderId: l.orderId,
    assignedTo: l.assignedUser ? { name: l.assignedUser.name, email: l.assignedUser.email } : null,
  }));

  const clean = (arr: (string | null)[]) =>
    Array.from(new Set(arr.filter((v): v is string => !!v && v.trim() !== ""))).sort();

  return NextResponse.json({
    leads,
    matched: matchedCount,
    returned: leads.length,
    counts: { total, assigned: assignedCount, unassigned: total - assignedCount },
    sources: clean(srcRows.map((r) => r.source)),
    campaigns: clean(campRows.map((r) => r.campaignName)),
    occupations: clean(occRows.map((r) => r.occupation)),
  });
}
