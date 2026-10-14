import { NextRequest, NextResponse } from "next/server";
import { emptyTrash, TRASH_RETENTION_DAYS } from "@/lib/trash";
import { sweepGoldmine } from "@/lib/goldmine";
import { isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/empty-trash — daily maintenance cron.
 *
 * Invoked by the Vercel Cron defined in vercel.json (daily). Runs two jobs so we
 * stay within the Hobby plan's cron-job limit:
 *   1. Empties the recycle bin (leads trashed longer than the retention window).
 *   2. Sweeps aged leads into the Goldmine pipeline (see lib/goldmine.ts).
 * Secured by CRON_SECRET: Vercel automatically sends
 * `Authorization: Bearer <CRON_SECRET>` when that env var is set on the project.
 * If CRON_SECRET is not configured, the endpoint refuses to run (safe default).
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
  const goldmine = await sweepGoldmine();
  return NextResponse.json({
    ok: true,
    purged,
    retentionDays: TRASH_RETENTION_DAYS,
    goldmine,
    ranAt: new Date().toISOString(),
  });
}
