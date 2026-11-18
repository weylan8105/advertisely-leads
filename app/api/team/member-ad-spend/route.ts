import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { getAdSpendSummary } from "@/lib/adSpend";
import { weeklyPaidIn } from "@/lib/memberAdSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team/member-ad-spend — for team managers: how much each member who runs
 * their own campaign (an advertiser) has put into ad spend, last 7 days and the
 * weekly average over 4 weeks. Card amounts are before the 3% fee.
 * { members: { userId, last7Cents, avgWeekCents }[] }
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ctx = await ensureOrgContext(userId);
  if (!ctx || !canManageTeam(ctx.role)) return NextResponse.json({ members: [] });

  const advertisers = await prisma.membership.findMany({
    where: { organizationId: ctx.organizationId, userId: { not: userId }, user: { isAdvertiser: true } },
    select: { userId: true },
  });
  const members = await Promise.all(
    advertisers.map(async ({ userId: id }) => {
      const s = await getAdSpendSummary(id).catch(() => null);
      return s ? { userId: id, ...weeklyPaidIn(s) } : null;
    }),
  );
  return NextResponse.json({ members: members.filter(Boolean) });
}
