// Stripe side of the Advertisely Advertiser Program (rules in lib/advertiserProgram.ts):
// the $500 / 2-week membership Price and enrolling a member. The membership
// payment is only the fee to be in the program: none of it becomes ad spend.
// Every step is idempotent, so the webhook and the marketplace page's own
// check can both run it.

import type Stripe from "stripe";
import { stripe } from "./stripe";
import { prisma } from "./prisma";
import { ADVERTISER_PROGRAM, ADVERTISER_PROGRAM_KIND, FEE_WAIVER } from "./advertiserProgram";
import { SHARED_POOL_ONLY, enforceAdSpend, forgetAdSpendSummary } from "./adSpend";

/** Find-or-create the program's recurring Price. */
export async function getProgramPriceId(): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");
  const { amountCents, intervalWeeks, name } = ADVERTISER_PROGRAM;
  const key = `advertiser_program_${intervalWeeks}w_${amountCents}`;
  const found = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (found.data[0]) return found.data[0].id;
  const price = await stripe.prices.create({
    currency: "usd",
    unit_amount: amountCents,
    recurring: { interval: "week", interval_count: intervalWeeks },
    lookup_key: key,
    product_data: { name },
  });
  return price.id;
}

/** Find-or-create the forever 100%-off coupon that waives the membership (FEE_WAIVER). */
export async function getFeeWaiverCouponId(): Promise<string> {
  if (!stripe) throw new Error("Stripe not configured");
  const id = FEE_WAIVER.couponId;
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch (e: any) {
    if (e?.code !== "resource_missing" && e?.statusCode !== 404) throw e;
  }
  try {
    await stripe.coupons.create({ id, percent_off: 100, duration: "forever", name: "Membership waived (Enhanced Wealth)" });
  } catch (e: any) {
    // Another request created it first.
    if (e?.code !== "resource_already_exists") throw e;
  }
  return id;
}

// feeWaivedAt: when the first waived payment was due, for the "saved so far" figure.
const waiverMetadata = (userId: string) => ({
  kind: ADVERTISER_PROGRAM_KIND,
  userId,
  feeWaived: FEE_WAIVER.key,
  feeWaivedAt: new Date().toISOString(),
});

/**
 * Join with the membership waived: a subscription to the same Price with the
 * waiver coupon, so every invoice is $0. Active right away, no card needed.
 * Throws when Stripe doesn't start it (and cancels what it left behind).
 */
export async function joinWithFeeWaived(userId: string, customerId: string): Promise<Stripe.Subscription> {
  if (!stripe) throw new Error("Stripe not configured");
  const sub = await stripe.subscriptions.create(
    {
      customer: customerId,
      items: [{ price: await getProgramPriceId() }],
      discounts: [{ coupon: await getFeeWaiverCouponId() }],
      metadata: waiverMetadata(userId),
      description: `${ADVERTISER_PROGRAM.name} (membership waived: ${FEE_WAIVER.label})`,
    },
    // A double click within the same minute makes one membership, not two.
    { idempotencyKey: `program-waived:${userId}:${Math.floor(Date.now() / 60_000)}` },
  );
  if (sub.status !== "active" && sub.status !== "trialing") {
    await stripe.subscriptions.cancel(sub.id).catch(() => {});
    throw new Error(`waived membership came back ${sub.status}`);
  }
  return sub;
}

/** A paying member who is on the waiver team: waive their membership from the next payment on. */
export async function waiveExistingMembership(sub: Stripe.Subscription): Promise<void> {
  if (!stripe || sub.metadata?.feeWaived) return;
  // The current period is already paid; the waiver starts with the next one.
  const end = (sub as any).items?.data?.[0]?.current_period_end ?? (sub as any).current_period_end;
  const feeWaivedAt = new Date(end ? end * 1000 : Date.now()).toISOString();
  await stripe.subscriptions.update(sub.id, {
    discounts: [{ coupon: await getFeeWaiverCouponId() }],
    metadata: { ...sub.metadata, feeWaived: FEE_WAIVER.key, feeWaivedAt },
    description: `${ADVERTISER_PROGRAM.name} (membership waived: ${FEE_WAIVER.label})`,
  });
}

/** Is the user on a team whose members join with the membership waived? */
export async function isOnFeeWaiverTeam(userId: string): Promise<boolean> {
  if (!prisma) return false;
  const n = await prisma.membership.count({ where: { userId, organizationId: { in: [...FEE_WAIVER.teamIds] } } });
  return n > 0;
}

/** The user's program subscriptions in Stripe, newest first. */
export async function findProgramSubscriptions(userId: string, email: string): Promise<Stripe.Subscription[]> {
  if (!stripe) return [];
  // Stripe matches emails exactly, so try it as typed and lowercased.
  const emails = [...new Set([email.trim(), email.trim().toLowerCase()])];
  const customers = (await Promise.all(emails.map((e) => stripe!.customers.list({ email: e, limit: 20 })))).flatMap((r) => r.data);
  const subs: Stripe.Subscription[] = [];
  for (const c of new Map(customers.map((c) => [c.id, c])).values()) {
    const list = await stripe.subscriptions.list({ customer: c.id, status: "all", limit: 20 });
    subs.push(...list.data.filter((s) => s.metadata?.kind === ADVERTISER_PROGRAM_KIND && s.metadata?.userId === userId));
  }
  return subs.sort((a, b) => b.created - a.created);
}

/**
 * Make a member an advertiser. Someone new gets their leads from the shared
 * pool only; an existing advertiser keeps their own campaigns as they are.
 */
export async function enrollProgramMember(userId: string): Promise<void> {
  if (!prisma) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true, adCampaignIds: true } });
  if (!u || u.isAdvertiser) return;
  await prisma.user.update({
    where: { id: userId },
    data: { isAdvertiser: true, adCampaignIds: u.adCampaignIds.length ? u.adCampaignIds : [SHARED_POOL_ONLY] },
  });
  forgetAdSpendSummary(userId);
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  // The subscription reference has moved around across API versions.
  const inv = invoice as any;
  const raw =
    inv.subscription ??
    inv.parent?.subscription_details?.subscription ??
    inv.subscription_details?.subscription ??
    inv.lines?.data?.find((l: any) => l.subscription)?.subscription ??
    null;
  return typeof raw === "string" ? raw : raw?.id ?? null;
}

/**
 * A paid program invoice: the membership is running, so make sure the member
 * is an advertiser and let their own campaign pick that up. Nothing is added
 * to their ad-spend balance. Returns false when the invoice isn't the
 * program's, so the caller can hand it to the lead subscription instead.
 */
export async function recordProgramInvoice(invoice: Stripe.Invoice): Promise<boolean> {
  if (!stripe || !prisma) return false;
  const subId = invoiceSubscriptionId(invoice);
  if (!subId) return false;
  const inv = invoice as any;
  let md: Record<string, string> | null = inv.parent?.subscription_details?.metadata ?? inv.subscription_details?.metadata ?? null;
  if (!md?.kind) md = (await stripe.subscriptions.retrieve(subId)).metadata ?? null;
  if (md?.kind !== ADVERTISER_PROGRAM_KIND) return false;

  const userId = md.userId;
  const paidCents = typeof inv.amount_paid === "number" ? inv.amount_paid : 0;
  if (!userId || inv.status !== "paid" || paidCents <= 0) return true;

  await enrollProgramMember(userId);
  forgetAdSpendSummary(userId);
  // A returning advertiser's own campaign resumes now that they are a member.
  await enforceAdSpend(userId).catch((e) => console.warn("[program] enforce failed", (e as Error).message));
  return true;
}

/**
 * Catch up on anything the webhook missed: someone whose membership has
 * started is an advertiser. Safe to run on every page load.
 */
export async function syncProgramMember(userId: string, subs: Stripe.Subscription[]): Promise<void> {
  if (!stripe || !prisma) return;
  const started = subs.filter((s) => s.status !== "incomplete" && s.status !== "incomplete_expired");
  if (!started.length) return;
  await enrollProgramMember(userId);
}
