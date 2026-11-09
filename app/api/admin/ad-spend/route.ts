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

/**
 * GET /api/admin/ad-spend — every advertiser's paid / spent / budget left.
 * ?quick=1 (the Client accounts progress bars) reuses summaries up to a minute old.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const fresh = req.nextUrl.searchParams.get("quick") !== "1";
  const users = await prisma.user.findMany({ where: { isAdvertiser: true }, select: { id: true }, orderBy: { createdAt: "asc" } });
  const summaries = [];
  for (const u of users) summaries.push(await getAdSpendSummary(u.id, { fresh }));
  return NextResponse.json({ summaries: summaries.filter(Boolean) });
}

/**
 * POST /api/admin/ad-spend { userId, autoPause?, campaignIds?, targetDate?, paymentEmails? } —
 * turn a client's budget management on/off, pin their campaign ids, or set the
 * date to spend their budget by (YYYY-MM-DD, or null for month end), or list other
 * emails they pay ad spend from in Stripe, then apply it.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!(await requireAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    userId?: string;
    autoPause?: boolean;
    campaignIds?: string[];
    targetDate?: string | null;
    paymentEmails?: string[];
  };
  if (body.targetDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) {
    return NextResponse.json({ error: "targetDate must be YYYY-MM-DD." }, { status: 400 });
  }
  if (!body.userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
  await prisma.user.update({
    where: { id: body.userId },
    data: {
      ...(typeof body.autoPause === "boolean" ? { adSpendAutoPause: body.autoPause } : {}),
      ...(Array.isArray(body.campaignIds) ? { adCampaignIds: body.campaignIds.map((s) => String(s).replace(/\D/g, "")).filter(Boolean) } : {}),
      ...(Array.isArray(body.paymentEmails)
        ? { adSpendEmails: [...new Set(body.paymentEmails.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))] }
        : {}),
      ...(body.targetDate !== undefined ? { adSpendTargetDate: body.targetDate ? new Date(`${body.targetDate}T00:00:00Z`) : null } : {}),
    },
  });
  const result = await enforceAdSpend(body.userId);
  return NextResponse.json({ result, summary: await getAdSpendSummary(body.userId, { fresh: true }) });
}
