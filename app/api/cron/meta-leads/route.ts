import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { pollMetaLeads } from "@/lib/metaLeadPoll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/meta-leads — pull recent leads for every mapped Meta form.
 *
 * Not scheduled: advertiser form leads arrive through GHL and are routed by form
 * id (lib/inboundIntake.ts). Running this alongside GHL would store each lead
 * twice (leadgen id vs GHL contact id). It stays as a manual tool — callable
 * with `Authorization: Bearer <CRON_SECRET>` or by a signed-in admin, and
 * `?dryRun=1` lists what would be ingested (ids only) without writing anything.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const bySecret = !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
  let byAdmin = false;
  if (!bySecret) {
    const session = await getServerSession(authOptions);
    byAdmin = (session?.user as any)?.role === "ADMIN";
  }
  if (!bySecret && !byAdmin) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";
  const forms = await pollMetaLeads({ dryRun });
  return NextResponse.json({ ok: true, dryRun, forms, ranAt: new Date().toISOString() });
}
