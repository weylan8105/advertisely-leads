import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/prisma";
import { sweepGoldmine } from "@/lib/goldmine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/goldmine-sweep — daily auto-move of aged leads into Goldmine.
 *
 * Invoked by the Vercel Cron in vercel.json. Secured by CRON_SECRET (Vercel
 * sends `Authorization: Bearer <CRON_SECRET>`); refuses to run without it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured) return NextResponse.json({ error: "Database not configured." }, { status: 503 });

  const result = await sweepGoldmine();
  return NextResponse.json({ ok: true, ...result, ranAt: new Date().toISOString() });
}
