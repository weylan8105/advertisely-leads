// Stripe side of the Advertisely Advertiser Program (rules in lib/advertiserProgram.ts):
// the $500 / 2-week Price, enrolling a member, and turning each paid invoice
// into balance. Every step is idempotent, so the webhook and the marketplace
// page's own check can both run it.

import type Stripe from "stripe";
import { stripe } from "./stripe";
import { prisma } from "./prisma";
import { ADVERTISER_PROGRAM, ADVERTISER_PROGRAM_KIND, programCreditCents, programFeeCents } from "./advertiserProgram";
import { SHARED_POOL_ONLY, enforceAdSpend, forgetAdSpendSummary } from "./adSpend";

// AdSpendPayment.method for a program payment's credit (the payment minus the fee).
export const PROGRAM_PAYMENT_METHOD = "program";

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

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
 * A paid program invoice: add the payment minus the 20% fee to the member's
 * balance (once per invoice) and apply it. Returns false when the invoice isn't
 * the program's, so the caller can hand it to the lead subscription instead.
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

  const ref = `program-invoice:${invoice.id}`;
  const paidAt = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000) : new Date();
  const recorded = await prisma.$transaction(async (tx) => {
    // The webhook and the marketplace page can see the same invoice at once.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ref}))`;
    const existing = await tx.adSpendPayment.findFirst({
      where: { userId, method: PROGRAM_PAYMENT_METHOD, note: { contains: ref } },
      select: { id: true },
    });
    if (existing) return false;
    await tx.adSpendPayment.create({
      data: {
        userId,
        amountCents: programCreditCents(paidCents),
        method: PROGRAM_PAYMENT_METHOD,
        receivedAt: paidAt,
        note: `${ADVERTISER_PROGRAM.name}: ${usd(paidCents)} paid, less ${usd(programFeeCents(paidCents))} management fee (20%) [${ref}]`,
      },
    });
    return true;
  });

  await enrollProgramMember(userId);
  forgetAdSpendSummary(userId);
  // A returning advertiser's own campaign picks the new balance up straight away.
  if (recorded) await enforceAdSpend(userId).catch((e) => console.warn("[program] enforce failed", (e as Error).message));
  return true;
}

/**
 * Catch up on anything the webhook missed: enroll the member and record every
 * paid invoice on their program subscriptions. Safe to run on every page load.
 */
export async function syncProgramMember(userId: string, subs: Stripe.Subscription[]): Promise<void> {
  if (!stripe || !prisma) return;
  const started = subs.filter((s) => s.status !== "incomplete" && s.status !== "incomplete_expired");
  if (!started.length) return;
  await enrollProgramMember(userId);
  const recorded = (
    await prisma.adSpendPayment.findMany({ where: { userId, method: PROGRAM_PAYMENT_METHOD }, select: { note: true } })
  ).map((r) => r.note ?? "").join("\n");
  for (const sub of started) {
    const invoices = await stripe.invoices.list({ subscription: sub.id, status: "paid", limit: 30 });
    for (const inv of invoices.data) {
      if (!recorded.includes(`program-invoice:${inv.id}`)) await recordProgramInvoice(inv);
    }
  }
}
