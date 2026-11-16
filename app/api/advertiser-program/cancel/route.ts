import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { forgetAdSpendSummary } from "@/lib/adSpend";
import { findProgramSubscriptions } from "@/lib/advertiserProgramBilling";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/advertiser-program/cancel { resume? } — stop the program at the end
 * of the current 2 weeks (cancel anytime), or undo that before it ends.
 */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured || !stripe) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const resume = !!((await req.json().catch(() => ({}))) as { resume?: boolean }).resume;
  const live = (await findProgramSubscriptions(userId, user.email)).find((s) => ["active", "trialing", "past_due"].includes(s.status));
  if (!live) return NextResponse.json({ error: "You're not in the Advertiser Program." }, { status: 400 });

  const updated: any = await stripe.subscriptions.update(live.id, { cancel_at_period_end: !resume });
  forgetAdSpendSummary(userId);
  const end = updated.items?.data?.[0]?.current_period_end ?? updated.current_period_end;
  const endLabel = end ? new Date(end * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" }) : "the end of this period";
  return NextResponse.json({
    ok: true,
    message: resume
      ? "You're staying in the Advertiser Program. Payments continue every 2 weeks."
      : `Your membership ends on ${endLabel}, with no more payments. Any balance you have left keeps buying leads.`,
  });
}
