// "Subscribe & save" weekly lead subscription.
//   $500/week → fresh leads at $55/lead = 9 leads/week, the ~$5 remainder rolls
//   over so nothing is lost. 4-week ($2,000) minimum, then auto-renews weekly.
// Backed by a Stripe subscription; each paid weekly invoice spawns one fresh-lead
// Order that flows through normal round-robin fulfillment.

import type Stripe from "stripe";
import { stripe } from "./stripe";
import { prisma } from "./prisma";
import { fulfillOrder } from "./fulfillment";
import { findPackage } from "@/data/packages";

export const SUB_WEEKLY_CENTS = 50_000; // $500/week
export const SUB_PRICE_PER_LEAD_CENTS = 5_500; // $55/lead
export const SUB_MIN_WEEKS = 4; // 4-week minimum commitment ($2,000)
export const SUB_PACKAGE_ID = "iul-fresh"; // real-time leads
export const SUB_PRICE_LOOKUP_KEY = "lead_sub_weekly_500";

/** Leads a given budget buys at $55/lead, and the leftover cents. */
export function leadsForCents(cents: number): { leads: number; remainder: number } {
  const leads = Math.floor(cents / SUB_PRICE_PER_LEAD_CENTS);
  return { leads, remainder: cents - leads * SUB_PRICE_PER_LEAD_CENTS };
}

/** Find-or-create the weekly $500 recurring Price (stable via lookup_key). */
export async function getWeeklyPriceId(): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");
  const found = await stripe.prices.list({ lookup_keys: [SUB_PRICE_LOOKUP_KEY], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: SUB_WEEKLY_CENTS,
    recurring: { interval: "week" },
    lookup_key: SUB_PRICE_LOOKUP_KEY,
    product_data: { name: "Advertisely Lead Subscription — $500/week" },
  });
  return price.id;
}

function mapStatus(s: Stripe.Subscription.Status): string {
  if (s === "active" || s === "trialing") return "active";
  if (s === "past_due" || s === "unpaid") return "past_due";
  if (s === "canceled" || s === "incomplete_expired") return "canceled";
  return "incomplete";
}

const periodEnd = (sub: Stripe.Subscription): Date | null =>
  (sub as any).current_period_end ? new Date((sub as any).current_period_end * 1000) : null;

/**
 * Upsert the local LeadSubscription record from a Stripe Subscription object.
 * The states/user/org travel in the subscription's metadata (set at checkout).
 */
export async function upsertLocalSubscription(sub: Stripe.Subscription) {
  if (!prisma) return null;
  const md = sub.metadata ?? {};
  const userId = md.userId;
  if (!userId) return null;
  const filterStates = md.filterStates ? md.filterStates.split(",").filter(Boolean) : [];
  const organizationId = md.organizationId || null;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;

  return prisma.leadSubscription.upsert({
    where: { stripeSubscriptionId: sub.id },
    update: {
      status: mapStatus(sub.status),
      currentPeriodEnd: periodEnd(sub),
      cancelAt: sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      stripeCustomerId: customerId,
    },
    create: {
      userId,
      organizationId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      status: mapStatus(sub.status),
      weeklyCents: SUB_WEEKLY_CENTS,
      pricePerLeadCents: SUB_PRICE_PER_LEAD_CENTS,
      minWeeks: SUB_MIN_WEEKS,
      filterStates,
      currentPeriodEnd: periodEnd(sub),
    },
  });
}

/**
 * Handle a paid weekly invoice: create the week's fresh-lead order (budget +
 * rollover), fulfill it, and advance the subscription. Idempotent per invoice.
 */
export async function processPaidInvoice(invoice: Stripe.Invoice) {
  if (!stripe || !prisma) return;
  // The subscription reference has moved around across API versions — check the
  // known locations.
  const inv = invoice as any;
  const rawSub =
    inv.subscription ??
    inv.parent?.subscription_details?.subscription ??
    inv.subscription_details?.subscription ??
    inv.lines?.data?.find((l: any) => l.subscription)?.subscription ??
    null;
  const subId = typeof rawSub === "string" ? rawSub : rawSub?.id ?? null;
  if (!subId) return; // not a subscription invoice

  // Idempotency — one order per invoice.
  const already = await prisma.order.findUnique({ where: { stripeInvoiceId: invoice.id } });
  if (already) return;

  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const local = await upsertLocalSubscription(stripeSub);
  if (!local) return;

  const budget = SUB_WEEKLY_CENTS + local.rolloverCents;
  const { leads, remainder } = leadsForCents(budget);

  if (leads > 0) {
    const pkg = findPackage(SUB_PACKAGE_ID);
    const order = await prisma.order.create({
      data: {
        userId: local.userId,
        organizationId: local.organizationId ?? undefined,
        packageId: SUB_PACKAGE_ID,
        quantity: leads,
        pricePerLeadCents: SUB_PRICE_PER_LEAD_CENTS,
        totalCents: leads * SUB_PRICE_PER_LEAD_CENTS,
        filterStates: local.filterStates,
        filterAgeMinDays: pkg?.ageMinDays,
        filterAgeMaxDays: pkg?.ageMaxDays,
        status: "PROCESSING",
        stripeInvoiceId: invoice.id,
      },
    });
    // Fill from existing inventory now; remaining quantity stays open for the
    // round-robin on fresh intake (like any order).
    await fulfillOrder(order.id);
  }

  await prisma.leadSubscription.update({
    where: { id: local.id },
    data: {
      rolloverCents: remainder,
      weeksBilled: { increment: 1 },
      currentPeriodEnd: periodEnd(stripeSub),
      status: "active",
    },
  });
}
