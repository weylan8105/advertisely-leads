import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext } from "@/lib/org";
import { IUL_POOL_IDS } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/assign-to-me
 *
 * Zero-cost self-assignment for admins. Pulls unassigned IUL leads from the
 * house pool straight into the admin's own CRM — no order, no payment. This is
 * how Ryan works leads himself for free.
 *
 * Body (all optional except quantity):
 *   quantity     number  — how many to pull (1–2000)
 *   states       string[]— restrict to these state codes (empty = any)
 *   ageMinDays   number  — only leads at least this old (receivedAt <= now-min)
 *   ageMaxDays   number  — only leads younger than this (receivedAt >  now-max)
 *
 * Requires ADMIN role.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  const role = (session?.user as any)?.role;
  if (!userId || role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    quantity?: number;
    states?: string[];
    ageMinDays?: number;
    ageMaxDays?: number;
    leadIds?: string[];
  };

  // Targeted assign: specific leads picked from search (assign only the ones
  // you've actually closed, not a blind batch).
  const leadIds = Array.isArray(body.leadIds)
    ? body.leadIds.map((x) => String(x)).filter(Boolean)
    : [];

  const quantity = Math.min(Math.max(parseInt(String(body.quantity), 10) || 0, 1), 2000);
  const states = Array.isArray(body.states)
    ? body.states.map((s) => String(s).toUpperCase()).filter(Boolean)
    : [];
  const ageMinDays = body.ageMinDays != null ? Number(body.ageMinDays) : undefined;
  const ageMaxDays = body.ageMaxDays != null ? Number(body.ageMaxDays) : undefined;

  // Make sure the admin has an organization so the leads land in their CRM view.
  const ctx = await ensureOrgContext(userId);
  const orgId = ctx?.organizationId;

  // Age window → receivedAt range (exclusive upper edge, matching the store).
  const dayMs = 86_400_000;
  const nowMs = Date.now();
  const receivedAt: { gt?: Date; lte?: Date } = {};
  if (ageMaxDays != null) receivedAt.gt = new Date(nowMs - ageMaxDays * dayMs);
  if (ageMinDays != null) receivedAt.lte = new Date(nowMs - ageMinDays * dayMs);

  // Only assignable leads: unassigned, not on a paid order, in the IUL pool.
  // For a targeted pick we restrict to the given ids; otherwise we filter+take.
  const where: any = leadIds.length
    ? {
        id: { in: leadIds },
        assignedUserId: null,
        orderId: null,
        packageId: { in: IUL_POOL_IDS },
      }
    : {
        assignedUserId: null,
        orderId: null,
        packageId: { in: IUL_POOL_IDS },
        ...(states.length ? { state: { in: states } } : {}),
        ...(receivedAt.gt || receivedAt.lte ? { receivedAt } : {}),
      };

  const candidates = await prisma.lead.findMany({
    where,
    orderBy: { receivedAt: "desc" }, // freshest first — best to work
    ...(leadIds.length ? {} : { take: quantity }),
    select: { id: true },
  });
  if (candidates.length === 0) {
    return NextResponse.json({
      assigned: 0,
      message: leadIds.length
        ? "That lead is no longer assignable (already assigned or on a paid order)."
        : "No matching unassigned leads in the pool.",
    });
  }

  const ids = candidates.map((c) => c.id);
  const now = new Date();
  const result = await prisma.lead.updateMany({
    where: { id: { in: ids }, assignedUserId: null }, // guard against races
    data: { assignedUserId: userId, assignedAt: now, organizationId: orgId ?? undefined },
  });
  await prisma.leadActivity.createMany({
    data: ids.map((id) => ({
      leadId: id,
      type: "LEAD_ASSIGNED" as const,
      body: "Self-assigned to admin CRM at zero cost.",
    })),
  });

  return NextResponse.json({ assigned: result.count });
}
