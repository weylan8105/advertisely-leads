import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { LEAD_TYPE_OPTIONS, enabledLeadTypes, storedLeadTypes } from "@/lib/leadTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/accounts/lead-types
 *
 * Admin-only: switch an advertiser's lead types (User.leadTypes) from Client
 * accounts, the same switches the advertiser has on their dashboard
 * (/api/advertiser/lead-types). The shared pool reads them on the next lead.
 *
 * Body: { userId: string, leadTypes: string[] } — the ids to have ON.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown; leadTypes?: unknown };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (!Array.isArray(body.leadTypes)) return NextResponse.json({ error: "leadTypes must be a list" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isAdvertiser: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (!user.isAdvertiser) {
    return NextResponse.json({ error: "Lead types are for advertiser accounts. Make them an advertiser first." }, { status: 400 });
  }

  const stored = storedLeadTypes(body.leadTypes);
  await prisma.user.update({ where: { id: user.id }, data: { leadTypes: stored } });
  return NextResponse.json({ userId: user.id, types: LEAD_TYPE_OPTIONS, leadTypes: enabledLeadTypes(stored) });
}
