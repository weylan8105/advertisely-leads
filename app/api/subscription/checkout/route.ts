import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { ensureOrgContext } from "@/lib/org";
import { getWeeklyPriceId, normalizeWeeklyCents } from "@/lib/leadSubscription";
import { AVAILABLE_STATES } from "@/data/states";
import { LEADS_PURCHASE_PAUSED, LEAD_SUBSCRIPTIONS_PUBLIC } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/subscription/checkout — start a weekly lead subscription. */
export async function POST(req: NextRequest) {
  if (LEADS_PURCHASE_PAUSED) return NextResponse.json({ error: "Lead purchasing is paused right now." }, { status: 503 });
  if (!isStripeConfigured || !stripe) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  const email = session?.user?.email ?? undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  if (!LEAD_SUBSCRIPTIONS_PUBLIC && !isAdmin) {
    return NextResponse.json({ error: "Subscriptions aren't open yet." }, { status: 403 });
  }

  // One active subscription per agent.
  const active = await prisma.leadSubscription.findFirst({
    where: { userId, status: { in: ["active", "past_due", "incomplete"] } },
    select: { id: true },
  });
  if (active) return NextResponse.json({ error: "You already have a subscription." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { states?: string[]; weeklyCents?: number };
  const valid = new Set(AVAILABLE_STATES.map((s) => String(s).toUpperCase()));
  const states = [...new Set((body.states ?? []).map((s) => String(s).toUpperCase()).filter((s) => valid.has(s)))];
  if (states.length === 0) {
    return NextResponse.json({ error: "Pick at least one state for your leads." }, { status: 400 });
  }
  // Weekly amount is customizable with a $500 minimum.
  const weeklyCents = normalizeWeeklyCents(body.weeklyCents ?? 0);

  const orgId = (await ensureOrgContext(userId))?.organizationId ?? "";
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");

  try {
    const priceId = await getWeeklyPriceId(weeklyCents);
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      // Metadata on the subscription so the webhook can build weekly orders.
      subscription_data: {
        metadata: { userId, organizationId: orgId, filterStates: states.join(","), weeklyCents: String(weeklyCents) },
      },
      metadata: { userId, kind: "lead-subscription" },
      success_url: `${base}/marketplace?tab=subscribe&status=success`,
      cancel_url: `${base}/marketplace?tab=subscribe&status=cancel`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    console.error("Subscription checkout failed:", e?.message ?? e);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
