import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { MIN_TOP_UP_CENTS, MAX_TOP_UP_CENTS, campaignCplCents } from "@/lib/adSpend";
import { TEAM_AD_SPEND_KIND, fundableMembership, teamFunding } from "@/lib/teamAdSpend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/team/ad-spend — the advertiser campaigns this member's uplines let
 * them add spend to, with their credit, leads so far and the campaign CPL.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ campaigns: [] });
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = await prisma.membership.findMany({
    where: { userId, adSpendAccess: true, organization: { owner: { isAdvertiser: true }, ownerId: { not: userId } } },
    select: { organization: { select: { ownerId: true, owner: { select: { name: true, email: true } } } } },
  });
  const campaigns = [];
  for (const m of memberships) {
    const advertiserId = m.organization.ownerId;
    const [funding, cplCents] = await Promise.all([teamFunding(advertiserId), campaignCplCents(advertiserId)]);
    const mine = funding.find((f) => f.userId === userId);
    const creditCents = Math.max(0, mine?.creditCents ?? 0);
    campaigns.push({
      advertiserId,
      advertiserName: m.organization.owner.name?.trim() || m.organization.owner.email,
      creditCents,
      addedCents: mine?.addedCents ?? 0,
      leads: mine?.leads ?? 0,
      leadCostCents: mine?.leadCostCents ?? 0,
      cplCents,
      leadsLeft: cplCents ? Math.floor(creditCents / cplCents) : null,
    });
  }
  return NextResponse.json({ campaigns });
}

/** POST /api/team/ad-spend { advertiserId, amountCents } — Stripe Checkout to fund the upline's campaign. */
export async function POST(req: NextRequest) {
  if (!isStripeConfigured || !stripe) return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { advertiserId?: string; amountCents?: number };
  if (!body.advertiserId || body.advertiserId === userId) {
    return NextResponse.json({ error: "Pick your upline's campaign." }, { status: 400 });
  }
  if (!(await fundableMembership(userId, body.advertiserId))) {
    return NextResponse.json({ error: "Your upline hasn't turned on campaign spend for you." }, { status: 403 });
  }
  const amountCents = Math.round(Number(body.amountCents) || 0);
  if (amountCents < MIN_TOP_UP_CENTS || amountCents > MAX_TOP_UP_CENTS) {
    return NextResponse.json(
      { error: `Enter an amount between $${MIN_TOP_UP_CENTS / 100} and $${(MAX_TOP_UP_CENTS / 100).toLocaleString()}.` },
      { status: 400 },
    );
  }

  const [user, advertiser] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
    prisma.user.findUnique({ where: { id: body.advertiserId }, select: { email: true, name: true } }),
  ]);
  if (!user || !advertiser) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  const advertiserName = advertiser.name?.trim() || advertiser.email;

  // The member's own Stripe customer; the webhook credits the upline's campaign
  // from the metadata (lib/teamAdSpend.ts), never from the member's email.
  const existing = (await stripe.customers.list({ email: user.email, limit: 1 })).data[0];
  const customer = existing ?? (await stripe.customers.create({ email: user.email, name: user.name ?? undefined, metadata: { userId } }));
  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const metadata = { kind: TEAM_AD_SPEND_KIND, userId, advertiserId: body.advertiserId };
  // Not titled "ad spend": that title is what counts a payment toward a
  // client's OWN campaign (lib/adSpend.ts).
  const title = `Team campaign funding: ${advertiserName}`;

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
            product_data: { name: title, description: "Credit for leads from your upline's campaign" },
          },
        },
      ],
      payment_intent_data: { metadata, description: title },
      metadata,
      success_url: `${base}/dashboard?teamtopup=success`,
      cancel_url: `${base}/dashboard?teamtopup=cancel`,
    });
    return NextResponse.json({ url: checkout.url });
  } catch (e: any) {
    console.error("Team ad spend checkout failed:", e?.message ?? e);
    return NextResponse.json({ error: "Could not start checkout. Please try again." }, { status: 502 });
  }
}
