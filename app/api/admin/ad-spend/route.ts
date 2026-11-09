import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getAdSpendSummary, enforceAdSpend } from "@/lib/adSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  return (session?.user as any)?.role === "ADMIN";
}

/** GET /api/admin/ad-spend — every advertiser's paid / spent / budget left. */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const users = await prisma.user.findMany({ where: { isAdvertiser: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const summaries = [];
  for (const u of users) summaries.push(await getAdSpendSummary(u.id, { fresh: true }));
  return NextResponse.json({ summaries: summaries.filter(Boolean) });
}

/**
 * POST /api/admin/ad-spend { userId, autoPause?, campaignIds? } — turn a client's
 * auto-pause on/off or pin their campaign ids, then apply it.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { userId?: string; autoPause?: boolean; campaignIds?: string[] };
  if (!body.userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
  await prisma.user.update({
    where: { id: body.userId },
    data: {
      ...(typeof body.autoPause === "boolean" ? { adSpendAutoPause: body.autoPause } : {}),
      ...(Array.isArray(body.campaignIds) ? { adCampaignIds: body.campaignIds.map((s) => String(s).replace(/\D/g, "")).filter(Boolean) } : {}),
    },
  });
  const result = await enforceAdSpend(body.userId);
  return NextResponse.json({ result, summary: await getAdSpendSummary(body.userId, { fresh: true }) });
}
