import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { leadPackages } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateIntentBody {
  packageId: string;
  quantity: number;
  filterStates?: string[];
  filterIncomeMin?: number;
}

/**
 * Create a Stripe PaymentIntent for a lead-package purchase.
 * The Order is NOT created here — it's created by the webhook after
 * payment_intent.succeeded fires, so we never have unpaid orders.
 */
export async function POST(req: NextRequest) {
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

  let body: CreateIntentBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pkg = leadPackages.find((p) => p.id === body.packageId);
  if (!pkg) {
    return NextResponse.json({ error: "Unknown package" }, { status: 400 });
  }
  if (!pkg.available) {
    return NextResponse.json(
      { error: `${pkg.name} is coming soon — pricing pending.` },
      { status: 400 },
    );
  }

  const qty = Number(body.quantity);
  if (!Number.isInteger(qty) || qty < pkg.minimumOrder) {
    return NextResponse.json(
      { error: `Quantity must be at least ${pkg.minimumOrder}` },
      { status: 400 },
    );
  }

  const amountCents = Math.round(qty * pkg.pricePerLead * 100);

  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    receipt_email: session.user.email ?? undefined,
    description: `${qty}× ${pkg.name}`,
    metadata: {
      userId: (session.user as any).id ?? "",
      userEmail: session.user.email ?? "",
      packageId: pkg.id,
      packageName: pkg.name,
      // For aged buckets, leads are fulfilled from the underlying pool
      // (`leadPackageId`) filtered to this age window.
      leadPackageId: pkg.leadPackageId ?? pkg.id,
      ageMinDays: pkg.ageMinDays != null ? String(pkg.ageMinDays) : "",
      ageMaxDays: pkg.ageMaxDays != null ? String(pkg.ageMaxDays) : "",
      quantity: String(qty),
      pricePerLead: String(pkg.pricePerLead),
      filterStates: (body.filterStates ?? []).join(","),
      filterIncomeMin: body.filterIncomeMin ? String(body.filterIncomeMin) : "",
    },
  });

  return NextResponse.json({
    clientSecret: intent.client_secret,
    amount: amountCents,
    paymentIntentId: intent.id,
  });
}
