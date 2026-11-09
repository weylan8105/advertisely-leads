import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getAdSpendSummary, enforceAdSpend } from "@/lib/adSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/advertiser/spend — the signed-in advertiser's campaign budget: paid,
 * spent (+3%), fees, budget left, leads and cost per lead. 403 for everyone
 * else. Admins can pass ?userId= to see a client's.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const me = (session?.user as any)?.id as string | undefined;
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = (session?.user as any)?.role === "ADMIN";

  const userId = (isAdmin && req.nextUrl.searchParams.get("userId")) || me;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true } });
  if (!user?.isAdvertiser) return NextResponse.json({ error: "Not an advertiser account." }, { status: 403 });

  const summary = await getAdSpendSummary(userId);
  if (!summary) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Coming back from Stripe: apply the new balance to the campaign right away.
  if (req.nextUrl.searchParams.get("topup") === "success" && userId === me) {
    await enforceAdSpend(userId).catch((e) => console.warn("ad spend enforce failed:", e));
    return NextResponse.json({ summary: (await getAdSpendSummary(userId, { fresh: true })) ?? summary });
  }
  return NextResponse.json({ summary });
}
