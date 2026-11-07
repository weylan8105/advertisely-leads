import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/prisma";
import { findUnlinkedForms, pollMetaLeads } from "@/lib/metaLeadPoll";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/meta-leads — pull recent leads for every mapped Meta form.
 *
 * This is the direct Meta connection: no GHL in between. It also flags forms on
 * connected Pages that are getting leads but aren't linked yet. A form still on
 * GHL can run alongside it, since findFormLeadCopy keeps the two from storing one
 * lead twice. Called by the Vercel Cron in vercel.json with
 * `Authorization: Bearer <CRON_SECRET>`, or by a signed-in admin. `?dryRun=1`
 * lists what would be ingested (ids only) without writing anything.
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
  const unlinkedForms = dryRun ? [] : await findUnlinkedForms();
  return NextResponse.json({ ok: true, dryRun, forms, unlinkedForms, ranAt: new Date().toISOString() });
}
