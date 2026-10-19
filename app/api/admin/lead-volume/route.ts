import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 86_400_000;

/** Overflow leads this admin has taken in the rolling 7-day window. */
async function received7d(userId: string): Promise<number> {
  if (!prisma) return 0;
  return prisma.lead.count({
    where: {
      assignedUserId: userId,
      orderId: null, // overflow / house-routed, not order-fulfilled purchases
      trashedAt: null,
      assignedAt: { gte: new Date(Date.now() - WEEK_MS) },
    },
  });
}

/** GET /api/admin/lead-volume — the admin's weekly overflow target + usage. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  if (!userId || !isAdmin) return NextResponse.json({ error: "Admin only" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ target: null, received7d: 0 });

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { weeklyLeadTarget: true } });
  return NextResponse.json({ target: me?.weeklyLeadTarget ?? null, received7d: await received7d(userId) });
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

  await prisma.user.update({ where: { id: userId }, data: { weeklyLeadTarget: target } });
  return NextResponse.json({ target, received7d: await received7d(userId) });
}
