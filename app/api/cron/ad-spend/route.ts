import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/prisma";
import { enforceAllAdSpend } from "@/lib/adSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/ad-spend — daily: re-apply each auto-pause client's budget to
 * their campaigns (new month, new fees, payments made outside the dashboard).
 * Meta's spend cap does the real-time stopping. Secured by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  return NextResponse.json({ ok: true, results: await enforceAllAdSpend(), ranAt: new Date().toISOString() });
}
