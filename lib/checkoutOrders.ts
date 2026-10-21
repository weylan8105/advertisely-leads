import { prisma } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
import { findPackage } from "@/data/packages";
import { ensureOrgContext } from "@/lib/org";
import { sendOrderConfirmationEmail, sendThankYouEmail, isEmailConfigured } from "@/lib/email";
import { settleBucks } from "@/lib/referral";

export interface PaidLine {
  packageId: string;
  quantity: number;
  /** Per-lead price actually charged; falls back to the package list price. */
  centsPerLead?: number;
}

/**
 * Create + fulfill the orders for one paid checkout. Used by the Stripe webhook
 * (card payments) and the Bucks-only order route. `paymentRef` is the Stripe
 * PaymentIntent id (or "bucks:<id>") and makes Bucks settlement idempotent.
 */
export async function placeCheckoutOrders(opts: {
  userId: string;
  lines: PaidLine[];
  filterStates: string[];
  deliverToUserId: string | null;
  paymentRef: string;
  stripePaymentIntentId?: string;
  /** What the buyer was actually charged on a card (for the receipt email). */
  chargedCents: number;
  referral?: { code: string; ownerId: string; earnsCents: number } | null;
  discountCents?: number;
  bucksAppliedCents?: number;
}): Promise<{ id: string; packageId: string }[]> {
  if (!prisma) return [];
  const md = { userId: opts.userId };
  const intent = { id: opts.paymentRef, amount: opts.chargedCents };
  const lines = opts.lines;
  const filterStates = opts.filterStates;
  let deliverToUserId = opts.deliverToUserId;

  // One Order per cart line. Price + age window resolve from the package def so
  // buckets keep their identity while fulfillment matches the underlying pool.
  const createdOrders: { id: string; packageId: string }[] = [];
  let totalQty = 0;
  // Stamp the buyer's org on every order up front so leads always inherit it.
  const buyerOrgId = (await ensureOrgContext(md.userId))?.organizationId ?? undefined;

  // Defense in depth: re-validate the delivery target at fulfillment time. It
  // must (still) be a member of the BUYER's own org, or we deliver to the buyer.
  // This guarantees one team can never direct leads into another team, even if
  // the target left the org between checkout and payment.
  if (deliverToUserId) {
    const member = buyerOrgId
      ? await prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId: buyerOrgId, userId: deliverToUserId } },
          select: { id: true },
        })
      : null;
    if (!member) {
      console.warn(
        "Stripe webhook: deliverTo target not in buyer's org — delivering to buyer instead",
        intent.id,
        deliverToUserId,
      );
      deliverToUserId = null;
    }
  }

  for (const line of lines) {
    const pkg = findPackage(line.packageId);
    if (!pkg) {
      console.error("Stripe webhook: unknown package on", intent.id, line.packageId);
      continue;
    }
    const cents = line.centsPerLead ?? Math.round(pkg.pricePerLead * 100);
    const order = await prisma.order.create({
      data: {
        userId: md.userId,
        organizationId: buyerOrgId,
        packageId: pkg.id, // bucket id, for display
        quantity: line.quantity,
        pricePerLeadCents: cents,
        totalCents: cents * line.quantity,
        filterStates,
        filterAgeMinDays: pkg.ageMinDays,
        filterAgeMaxDays: pkg.ageMaxDays,
        deliverToUserId,
        status: "PROCESSING",
        stripePaymentIntentId: opts.stripePaymentIntentId,
      },
    });
    createdOrders.push({ id: order.id, packageId: order.packageId });
    totalQty += line.quantity;
    // Immediately try to fill each order from existing inventory.
    await fulfillOrder(order.id);
  }
  if (createdOrders.length === 0) return createdOrders;
  const firstOrder = createdOrders[0];

  // Advertisely Bucks Marketing Campaign (draft): the discount + Bucks are recorded on the first
  // order of the checkout, then balances settle (idempotent per paymentRef).
  const bucksSpent = opts.bucksAppliedCents ?? 0;
  if (opts.referral || bucksSpent > 0 || (opts.discountCents ?? 0) > 0) {
    await prisma.order.update({
      where: { id: firstOrder.id },
      data: {
        referralCode: opts.referral?.code ?? null,
        referrerUserId: opts.referral?.ownerId ?? null,
        discountCents: opts.discountCents ?? 0,
        bucksAppliedCents: bucksSpent,
      },
    });
    await settleBucks({
      paymentRef: opts.paymentRef,
      buyerUserId: opts.userId,
      orderId: firstOrder.id,
      bucksSpentCents: bucksSpent,
      referrerUserId: opts.referral?.ownerId ?? null,
      referrerEarnsCents: opts.referral?.earnsCents ?? 0,
      referralCode: opts.referral?.code ?? null,
    });
  }

  // Send order confirmation + thank-you, summarized across the whole cart.
  if (isEmailConfigured) {
    try {
      const user = await prisma?.user.findUnique({
        where: { id: md.userId },
        select: { email: true, name: true },
      });
      if (user?.email) {
        const label =
          createdOrders.length === 1
            ? findPackage(createdOrders[0].packageId)?.name ?? createdOrders[0].packageId
            : `${createdOrders.length} lead tiers`;
        // Transactional receipt
        await sendOrderConfirmationEmail({
          agentEmail: user.email,
          agentName: user.name ?? "Agent",
          packageName: label,
          quantity: totalQty,
          totalCents: intent.amount,
          orderId: firstOrder.id,
        });
        // Personal thank-you
        await sendThankYouEmail({
          clientEmail: user.email,
          clientName: user.name ?? "Agent",
          packageName: label,
          quantity: totalQty,
          totalCents: intent.amount,
          orderId: firstOrder.id,
        });
      }
    } catch (emailErr) {
      console.warn("Order emails failed:", emailErr);
    }
  }
  return createdOrders;
}
