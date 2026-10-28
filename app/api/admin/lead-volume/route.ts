import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;

/**
 * Overflow leads this admin has taken in the rolling 7-day window — the exact
 * count the round-robin cap uses (lib/house.ts getEligibleAdminSlots) — plus,
 * when they're at/over target, when enough of those leads age out of the window
 * to put them back in the rotation.
 */
async function usage(userId: string, target: number | null): Promise<{ received7d: number; pausedUntil: string | null }> {
  if (!prisma) return { received7d: 0, pausedUntil: null };
  const inWindow = await prisma.lead.findMany({
    where: {
      assignedUserId: userId,
      orderId: null, // overflow / house-routed, not order-fulfilled purchases
      trashedAt: null,
      assignedAt: { gte: new Date(Date.now() - WEEK_MS) },
    },
    orderBy: { assignedAt: "asc" },
    select: { assignedAt: true },
  });
  const got = inWindow.length;
  let pausedUntil: string | null = null;
  if (target && got >= target) {
    // Back under target once (got - target + 1) of the oldest leads leave the window.
    const t = inWindow[got - target]?.assignedAt;
    if (t) pausedUntil = new Date(t.getTime() + WEEK_MS).toISOString();
  }
  return { received7d: got, pausedUntil };
}

/** Recent target changes. Empty (never throws) if the log table isn't there yet. */
async function history(userId: string) {
  if (!prisma) return [];
  try {
    const rows = await prisma.weeklyTargetChange.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 8,
    });
    const ids = [...new Set(rows.map((r) => r.changedById).filter((x): x is string => !!x))];
    const users = ids.length
      ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
      : [];
    const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
    return rows.map((r) => ({
      at: r.createdAt.toISOString(),
      from: r.oldTarget,
      to: r.newTarget,
      by: (r.changedById && nameOf.get(r.changedById)) || null,
    }));
  } catch (e) {
    console.warn("[lead-volume] target history unavailable:", (e as Error).message);
    return [];
  }
}

/** GET /api/admin/lead-volume — the admin's weekly overflow target + usage. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  if (!userId || !isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ target: null, received7d: 0 });

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { weeklyLeadTarget: true } });
  const target = me?.weeklyLeadTarget ?? null;
  return NextResponse.json({ target, ...(await usage(userId, target)), history: await history(userId) });
}

/** PUT /api/admin/lead-volume — set the admin's weekly overflow target. */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  if (!userId || !isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { target?: number | null };
  let target: number | null;
  if (body.target === null || body.target === undefined || Number(body.target) <= 0) {
    target = null; // 0 / blank = not taking overflow
  } else {
    target = Math.min(100_000, Math.max(1, Math.round(Number(body.target))));
  }

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { weeklyLeadTarget: true } });
  const oldTarget = before?.weeklyLeadTarget ?? null;
  await prisma.user.update({ where: { id: userId }, data: { weeklyLeadTarget: target } });
  if (oldTarget !== target) {
    try {
      await prisma.weeklyTargetChange.create({
        data: { userId, changedById: userId, oldTarget, newTarget: target },
      });
    } catch (e) {
      // The target itself is saved; only the audit row failed (e.g. table missing).
      console.warn("[lead-volume] could not log target change:", (e as Error).message);
    }
  }
  return NextResponse.json({ target, ...(await usage(userId, target)), history: await history(userId) });
}
