import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { AD_SPEND_KIND, MIN_TOP_UP_CENTS, MAX_TOP_UP_CENTS } from "@/lib/adSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/advertiser/spend/top-up { amountCents } — Stripe Checkout to add ad spend. */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured || !stripe) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true, email: true, name: true } });
  if (!user?.isAdvertiser) return NextResponse.json({ error: "Not an advertiser account." }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { amountCents?: number };
  const amountCents = Math.round(Number(body.amountCents) || 0);
  if (amountCents < MIN_TOP_UP_CENTS || amountCents > MAX_TOP_UP_CENTS) {
    return NextResponse.json(
      { error: `Enter an amount between $${MIN_TOP_UP_CENTS / 100} and $${(MAX_TOP_UP_CENTS / 100).toLocaleString()}.` },
      { status: 400 },
    );
  }

  // Pay on the client's Stripe customer so the payment counts toward their budget.
  const existing = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0];
  const customer = existing ?? (await stripe.customers.create({ email: user.email, name: user.name ?? undefined, metadata: { userId } }));
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const metadata = { kind: AD_SPEND_KIND, userId };

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customer.id,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: { name: "Advertisely campaign ad spend", description: user.name ? `Ad spend for ${user.name}` : undefined },
          },
        },
      ],
      payment_intent_data: { metadata, description: "Advertisely campaign ad spend" },
      metadata,
      success_url: `${base}/dashboard?topup=success`,
      cancel_url: `${base}/dashboard?topup=cancel`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    console.error("Ad spend checkout failed:", e?.message ?? e);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
