import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { OPT_IN_LEAD_TYPES, cleanLeadTypes } from "@/lib/leadTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/advertiser/lead-types — the opt-in lead types and which ones I have on.
 * PUT  { leadTypes: string[] } — set mine. Advertisers only.
 */
async function me() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id as string | undefined;
  if (!id || !prisma) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, isAdvertiser: true, leadTypes: true } });
  return user;
}

export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const user = await me();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isAdvertiser) return NextResponse.json({ error: "Not an advertiser account." }, { status: 403 });
  return NextResponse.json({ types: OPT_IN_LEAD_TYPES, enabled: cleanLeadTypes(user.leadTypes) });
}

export async function PUT(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const user = await me();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.isAdvertiser) return NextResponse.json({ error: "Not an advertiser account." }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const enabled = cleanLeadTypes(body?.leadTypes);
  await prisma.user.update({ where: { id: user.id }, data: { leadTypes: enabled } });
  return NextResponse.json({ types: OPT_IN_LEAD_TYPES, enabled });
}
