import { NextRequest, NextResponse } from "next/server";
import { emptyTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/empty-trash — scheduled recycle-bin cleanup.
 *
 * Invoked by the Vercel Cron defined in vercel.json (daily). Deletes leads that
 * have sat in the trash longer than the retention window. Secured by CRON_SECRET:
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when that env
 * var is set on the project. If CRON_SECRET is not configured, the endpoint
 * refuses to run (safe default) — set it in the Vercel project env.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const purged = await emptyTrash(TRASH_RETENTION_DAYS);
  return NextResponse.json({ ok: true, purged, retentionDays: TRASH_RETENTION_DAYS, ranAt: new Date().toISOString() });
}
