import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { buildHouseLeadInvoice } from "@/lib/houseLeadInvoice";
import { isEmailConfigured, sendHouseLeadInvoiceEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cron/house-lead-invoice — weekly house-lead settlement.
 *
 * Invoked by the Vercel Cron in vercel.json (Monday morning). Computes the
 * current blended CPL (last-7d spend across both ad accounts ÷ leads generated),
 * totals each admin's house (overflow) leads for the week, and emails every
 * admin an invoice of what they owe at cost. Secured by CRON_SECRET, exactly
 * like the other crons.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured." }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  if (!isEmailConfigured) {
    return NextResponse.json({ error: "Email not configured (RESEND_API_KEY)." }, { status: 503 });
  }

  const invoice = await buildHouseLeadInvoice();
  if (!invoice) return NextResponse.json({ error: "Could not build invoice." }, { status: 503 });

  // Nothing taken this week → no email, just report.
  if (invoice.lines.length === 0) {
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), sent: 0, reason: "no house leads this week", invoice });
  }

  const adminUsers = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const envAdmins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const recipients = Array.from(
    new Map([...adminUsers.map((u) => u.email), ...envAdmins].filter((e): e is string => !!e).map((e) => [e.toLowerCase(), e])).values(),
  );
  if (recipients.length === 0) {
    return NextResponse.json({ ok: false, error: "No admin recipients found.", invoice }, { status: 200 });
  }

  const results = await Promise.all(
    recipients.map((to) =>
      sendHouseLeadInvoiceEmail({ toEmail: to, invoice }).then(
        (r) => ({ to, ...r }),
        (err) => ({ to, success: false, error: String(err?.message ?? err) }),
      ),
    ),
  );

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    cplCents: invoice.cplCents,
    cplSource: invoice.cplSource,
    totalHouseLeads: invoice.totalHouseLeads,
    totalOwedCents: invoice.totalOwedCents,
    lines: invoice.lines,
    recipients: results,
  });
}
