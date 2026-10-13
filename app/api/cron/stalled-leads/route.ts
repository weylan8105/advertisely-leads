import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { buildClientActivityReport } from "@/lib/leadActivity";
import { isEmailConfigured, sendStalledLeadsDigestEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/stalled-leads — weekly "who isn't working their leads" alert.
 *
 * Invoked by the Vercel Cron in vercel.json (weekly, Monday morning). Builds the
 * per-client activity report and emails every admin a digest of flagged clients
 * (never worked a lead / piled-up New Lead inventory / gone quiet). Secured by
 * CRON_SECRET exactly like empty-trash: Vercel sends
 * `Authorization: Bearer <CRON_SECRET>` automatically when the env var is set.
 *
 * Recipients = all ADMIN users plus any address in ADMIN_EMAILS (comma-sep),
 * deduped. Low volume (a few emails/week) — no material email cost.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  if (!isEmailConfigured) {
    return NextResponse.json({ error: "Email not configured (RESEND_API_KEY)." }, { status: 503 });
  }

  const report = await buildClientActivityReport();

  // Admins by role + any ADMIN_EMAILS override, deduped (case-insensitive).
  const adminUsers = await prisma.user.findMany({
    where: { role: "ADMIN" },
    select: { email: true },
  });
  const envAdmins = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const recipients = Array.from(
    new Map(
      [...adminUsers.map((u) => u.email), ...envAdmins]
        .filter((e): e is string => !!e)
        .map((e) => [e.toLowerCase(), e]),
    ).values(),
  );

  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, error: "No admin recipients found." }, { status: 200 });
  }

  const flagged = report.flagged.map((c) => ({
    name: c.name,
    email: c.email,
    total: c.total,
    idle: c.idle,
    worked: c.worked,
    workedPct: c.workedPct,
    converted: c.converted,
    quietDays: c.quietDays,
    reasons: c.reasons,
  }));

  const results = await Promise.all(
    recipients.map((to) =>
      sendStalledLeadsDigestEmail({ toEmail: to, flagged, totals: report.totals }).then(
        (r) => ({ to, ...r }),
        (err) => ({ to, success: false, error: String(err?.message ?? err) }),
      ),
    ),
  );

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    flaggedClients: flagged.length,
    totals: report.totals,
    recipients: results,
  });
}
