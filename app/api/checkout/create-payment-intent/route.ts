import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { leadPackages } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CartLine {
  packageId: string;
  quantity: number;
}
interface CreateIntentBody {
  // Multi-item cart checkout.
  items?: CartLine[];
  filterStates?: string[];
  // Legacy single-item fields (still accepted).
  packageId?: string;
  quantity?: number;
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

  // Normalize to a list of cart lines (accept the legacy single-item body too).
  const rawLines: CartLine[] =
    body.items && body.items.length > 0
      ? body.items
      : body.packageId
        ? [{ packageId: body.packageId, quantity: Number(body.quantity) }]
        : [];
  if (rawLines.length === 0) {
    return NextResponse.json({ error: "Your cart is empty" }, { status: 400 });
  }

  let amountCents = 0;
  const validated: CartLine[] = [];
  for (const line of rawLines) {
    const pkg = leadPackages.find((p) => p.id === line.packageId && !p.hidden);
    if (!pkg) {
      return NextResponse.json({ error: `Unknown package: ${line.packageId}` }, { status: 400 });
    }
    if (!pkg.available) {
      return NextResponse.json(
        { error: `${pkg.name} is coming soon — pricing pending.` },
        { status: 400 },
      );
    }
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < pkg.minimumOrder) {
      return NextResponse.json(
        { error: `${pkg.name}: minimum order is ${pkg.minimumOrder} leads.` },
        { status: 400 },
      );
    }
    amountCents += Math.round(qty * pkg.pricePerLead * 100);
    validated.push({ packageId: pkg.id, quantity: qty });
  }

  // Compact line encoding for Stripe metadata (500-char/value limit).
  const itemsMeta = JSON.stringify(validated.map((v) => ({ p: v.packageId, q: v.quantity })));
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
    amount: amountCents,
    currency: "usd",
    automatic_payment_methods: { enabled: true },
    receipt_email: session.user.email ?? undefined,
    description,
    metadata: {
      userId: (session.user as any).id ?? "",
      userEmail: session.user.email ?? "",
      items: itemsMeta,
      filterStates: (body.filterStates ?? []).join(","),
    },
  });

  return NextResponse.json({
    clientSecret: intent.client_secret,
    amount: amountCents,
    paymentIntentId: intent.id,
  });
}
