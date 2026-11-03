import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/accounts/advertiser
 *
 * Admin-only toggle for the advertiser flag. Advertisers normally self-identify
 * the first time one of their exclusive leads lands (deliverLeadToOwner flips
 * User.isAdvertiser), but this lets an admin pre-designate — or un-designate —
 * an account before any lead arrives, so a new advertiser shows in the
 * Advertisers segment of the Client-accounts tab from the moment they're set up.
 *
 * Body: { userId: string, isAdvertiser: boolean }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { userId?: string; isAdvertiser?: boolean };
  const userId = String(body.userId ?? "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  const isAdvertiser = body.isAdvertiser === true;

  const res = await prisma.user.updateMany({
    where: { id: userId },
    data: { isAdvertiser },
  });
  if (res.count === 0) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ userId, isAdvertiser });
}
