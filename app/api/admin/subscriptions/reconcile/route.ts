import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stripe, isStripeConfigured } from "@/lib/stripe";
import { processPaidInvoice } from "@/lib/leadSubscription";
import type Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/subscriptions/reconcile — admin-only safety net.
 *
 * Pulls every paid Stripe invoice for each active lead subscription and runs it
 * through the same handler the `invoice.paid` webhook uses, creating any missing
 * weekly fresh-lead orders (idempotent per invoice). Use this to catch up after
 * a webhook outage or when the Stripe endpoint wasn't subscribed to the invoice
 * events, without waiting for the next billing cycle.
 */
export async function POST() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!isStripeConfigured || !stripe) {
    return NextResponse.json({ error: "Stripe is not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const subs = await prisma.leadSubscription.findMany({
    where: { status: { not: "canceled" } },
    include: { user: { select: { email: true, name: true } } },
  });

  let ordersCreated = 0;
  let invoicesProcessed = 0;
  const results: {
    email: string | null;
    paidInvoices: number;
    ordersCreated: number;
    error?: string;
  }[] = [];

  for (const sub of subs) {
    const row = { email: sub.user?.email ?? null, paidInvoices: 0, ordersCreated: 0 } as (typeof results)[number];
    try {
      // Oldest → newest so rollover chains across weeks in the right order.
      const invoices: Stripe.Invoice[] = [];
      for await (const inv of stripe.invoices.list({
        subscription: sub.stripeSubscriptionId,
        status: "paid",
        limit: 100,
      })) {
        invoices.push(inv);
      }
      invoices.sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
      row.paidInvoices = invoices.length;

      for (const inv of invoices) {
        const res = await processPaidInvoice(inv);
        invoicesProcessed++;
        if (res?.created) {
          row.ordersCreated++;
          ordersCreated++;
        }
      }
    } catch (err: any) {
      row.error = err?.message ?? "Failed to reconcile";
    }
    results.push(row);
  }

  return NextResponse.json({
    ok: true,
    subscriptions: subs.length,
    invoicesProcessed,
    ordersCreated,
    results,
  });
}
