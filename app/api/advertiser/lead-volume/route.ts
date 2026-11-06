import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { advertiserUsage, MAX_ADVERTISER_KEEP } from "@/lib/advertiserVolume";
import { primaryOwnedTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The signed-in advertiser's keep amount + team size, or a 403 for everyone else. */
async function load(userId: string) {
  if (!prisma) return null;
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      isAdvertiser: true,
      advertiserWeeklyKeep: true,
      defaultOrganizationId: true,
      ownedOrganizations: {
        select: { id: true, distributionMode: true, _count: { select: { memberships: { where: { pendingApproval: false } } } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!me?.isAdvertiser) return null;
  const team = primaryOwnedTeam(me.ownedOrganizations, me.defaultOrganizationId);
  const keep = me.advertiserWeeklyKeep ?? null;
  return {
    keep,
    ...(await advertiserUsage(userId, keep)),
    teammates: Math.max(0, (team?._count.memberships ?? 1) - 1),
    distributionMode: team?.distributionMode ?? "MANUAL",
  };
}

/** GET /api/advertiser/lead-volume — how many campaign leads the advertiser keeps per rolling 7 days. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const data = await load(userId);
  if (!data) return NextResponse.json({ error: "Advertisers only" }, { status: 403 });
  return NextResponse.json(data);
}

/**
 * PUT /api/advertiser/lead-volume  Body: { keep: number | null }
 * null/blank = keep every lead; 0 = the team gets all of them.
 */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!(await load(userId))) return NextResponse.json({ error: "Advertisers only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { keep?: number | string | null };
  const raw = body.keep;
  const keep =
    raw === null || raw === undefined || raw === "" || isNaN(Number(raw))
      ? null
      : Math.min(MAX_ADVERTISER_KEEP, Math.max(0, Math.round(Number(raw))));
  await prisma.user.update({ where: { id: userId }, data: { advertiserWeeklyKeep: keep } });
  return NextResponse.json(await load(userId));
}
