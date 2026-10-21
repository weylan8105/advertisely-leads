import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { leadPackages } from "@/data/packages";
import { quoteCheckout, type CheckoutBody } from "@/lib/checkoutQuote";
import { LEADS_PURCHASE_PAUSED, PURCHASE_PAUSED_MESSAGE } from "@/lib/flags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Create a Stripe PaymentIntent for a lead-package purchase.
 * The Order is NOT created here — it's created by the webhook after
 * payment_intent.succeeded fires, so we never have unpaid orders.
 */
export async function POST(req: NextRequest) {
  // Kill switch: purchasing is paused — never create a payment intent.
  if (LEADS_PURCHASE_PAUSED) {
    return NextResponse.json({ error: PURCHASE_PAUSED_MESSAGE }, { status: 503 });
  }
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured yet" },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "You must be signed in to check out" },
      { status: 401 },
    );
  }

  let body: CheckoutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const buyer = { id: (session.user as any).id as string, role: (session.user as any).role as string | undefined };
  const quote = await quoteCheckout(buyer, body);
  if (!quote.ok) return NextResponse.json(quote.body, { status: quote.status });
  const { validated, priced, deliverToUserId, referral } = quote;

  // Bucks cover the whole order → no card payment; the client places it via
  // /api/checkout/bucks-order instead.
  if (priced.chargeCents === 0) {
    return NextResponse.json({ coveredByBucks: true, priced });
  }

  // Compact line encoding for Stripe metadata (500-char/value limit). `c` is the
  // per-lead price actually charged (after any referral discount).
  const itemsMeta = JSON.stringify(priced.lines.map((l) => ({ p: l.packageId, q: l.quantity, c: l.centsPerLead })));
  if (itemsMeta.length > 480) {
    return NextResponse.json(
      { error: "Too many line items in one order — please split it." },
      { status: 400 },
    );
  }

  const totalLeads = validated.reduce((s, v) => s + v.quantity, 0);
  const description =
    validated.length === 1
      ? `${validated[0].quantity}× ${leadPackages.find((p) => p.id === validated[0].packageId)?.name ?? "leads"}`
      : `${validated.length} lead tiers (${totalLeads} leads)`;

  const intent = await stripe.paymentIntents.create({
    amount: priced.chargeCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    receipt_email: session.user.email ?? undefined,
    description,
    metadata: {
      userId: (session.user as any).id ?? "",
      userEmail: session.user.email ?? "",
      items: itemsMeta,
      filterStates: quote.filterStates.join(","),
      deliverToUserId,
      // Advertisely Bucks Marketing Campaign (draft) — empty/0 when not used.
      referralCode: referral?.code ?? "",
      referrerUserId: referral?.ownerId ?? "",
      referrerEarnsCents: String(referral ? priced.referrerEarnsCents : 0),
      discountCents: String(priced.discountCents),
      bucksCents: String(priced.bucksAppliedCents),
    },
  });

  return NextResponse.json({
    clientSecret: intent.client_secret,
    amount: priced.chargeCents,
    priced,
    paymentIntentId: intent.id,
  });
}
