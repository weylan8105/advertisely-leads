import { randomInt } from "crypto";
import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/referralPricing";

/**
 * Advertisely Bucks Marketing Campaign (DRAFT — gated by REFERRAL_PROGRAM_ENABLED).
 *
 * - Every account has its own code, generated from its name (WEYLAN7K) and
 *   editable on /rewards. Using someone's code takes 10% off fresh leads.
 * - The code's owner earns $12 in Bucks per fresh lead bought with it — no cap.
 * - Bucks pay for future lead orders — no cap. Platform ADMINs neither earn nor
 *   spend them (an admin's code still gives the buyer the discount).
 * - Every balance change is a BucksTransaction row; User.bucksCents is the
 *   running balance, updated in the same transaction.
 */

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function codeBase(name: string | null, email: string): string {
  const first = (name ?? "").trim().split(/\s+/)[0] || email.split("@")[0];
  const base = normalizeCode(first).replace(/[0-9]/g, "").slice(0, 10);
  return base.length >= 2 ? base : "AGENT";
}

function suffix(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/** The user's referral code, generating a unique one from their name if missing. */
export async function ensureReferralCode(userId: string): Promise<string | null> {
  if (!prisma) return null;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true, name: true, email: true } });
  if (!u) return null;
  if (u.referralCode) return u.referralCode;
  const base = codeBase(u.name, u.email);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = base + suffix(attempt < 4 ? 2 : 4);
    try {
      // Only set it if still empty, so two concurrent calls can't overwrite each other.
      const res = await prisma.user.updateMany({ where: { id: userId, referralCode: null }, data: { referralCode: code } });
      if (res.count === 0) {
        return (await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } }))?.referralCode ?? null;
      }
      return code;
    } catch (e: any) {
      if (e?.code !== "P2002") throw e; // unique clash → try another suffix
    }
  }
  return null;
}

/** Resolve a code typed at checkout to its owner. */
export async function findCodeOwner(raw: string) {
  if (!prisma) return null;
  const code = normalizeCode(raw);
  if (!code) return null;
  return prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true, name: true, role: true, referralCode: true },
  });
}

export const isAdminRole = (role: string | null | undefined) => role === "ADMIN";

/**
 * Settle Bucks for one paid checkout (idempotent per paymentRef):
 * debit what the buyer spent, credit the code's owner what they earned.
 * The unique (paymentRef, userId, kind) index makes webhook retries no-ops.
 */
export async function settleBucks(opts: {
  paymentRef: string;
  buyerUserId: string;
  orderId: string;
  bucksSpentCents: number;
  referrerUserId: string | null;
  referrerEarnsCents: number;
  referralCode: string | null;
}) {
  if (!prisma) return;
  const db = prisma;
  const entry = async (userId: string, amountCents: number, kind: "EARN" | "SPEND", note: string, sourceUserId?: string) => {
    try {
      await db.$transaction([
        db.bucksTransaction.create({
          data: { userId, amountCents, kind, note, sourceUserId, orderId: opts.orderId, paymentRef: opts.paymentRef },
        }),
        db.user.update({ where: { id: userId }, data: { bucksCents: { increment: amountCents } } }),
      ]);
    } catch (e: any) {
      if (e?.code !== "P2002") throw e; // already settled
    }
  };
  if (opts.bucksSpentCents > 0) {
    await entry(opts.buyerUserId, -opts.bucksSpentCents, "SPEND", "Spent on a lead order");
  }
  if (opts.referrerUserId && opts.referrerEarnsCents > 0 && opts.referrerUserId !== opts.buyerUserId) {
    const ref = await db.user.findUnique({ where: { id: opts.referrerUserId }, select: { role: true } });
    if (ref && !isAdminRole(ref.role)) {
      await entry(opts.referrerUserId, opts.referrerEarnsCents, "EARN", `Someone ordered with your code ${opts.referralCode ?? ""}`.trim(), opts.buyerUserId);
    }
  }
}

/**
 * A referred order was refunded (fully or partly): take back the Bucks its
 * code's owner earned, in proportion to the refund — but only what's still in
 * their balance. Bucks already spent can't be recovered, so the balance never
 * goes below $0. Idempotent per (paymentRef, cumulative refunded amount).
 */
export async function clawbackReferralBucks(paymentRef: string, refundedCents: number, chargedCents: number) {
  if (!prisma || chargedCents <= 0 || refundedCents <= 0) return;
  const db = prisma;
  const earns = await db.bucksTransaction.findMany({ where: { paymentRef, kind: "EARN" }, select: { userId: true, amountCents: true } });
  for (const e of earns) {
    const target = Math.round(e.amountCents * Math.min(1, refundedCents / chargedCents));
    const prior = await db.bucksTransaction.aggregate({
      where: { userId: e.userId, kind: "CLAWBACK", paymentRef: { startsWith: `${paymentRef}:refund:` } },
      _sum: { amountCents: true },
    });
    const owed = target + (prior._sum.amountCents ?? 0); // prior clawbacks are negative
    if (owed <= 0) continue;
    try {
      await db.$transaction(async (tx) => {
        const u = await tx.user.findUnique({ where: { id: e.userId }, select: { bucksCents: true } });
        const take = Math.min(owed, Math.max(0, u?.bucksCents ?? 0));
        if (take <= 0) return; // already spent — nothing to take back
        await tx.bucksTransaction.create({
          data: {
            userId: e.userId,
            amountCents: -take,
            kind: "CLAWBACK",
            note: "Referred order was refunded",
            paymentRef: `${paymentRef}:refund:${refundedCents}`,
          },
        });
        await tx.user.update({ where: { id: e.userId }, data: { bucksCents: { decrement: take } } });
      });
    } catch (err: any) {
      if (err?.code !== "P2002") throw err; // this refund event was already handled
    }
  }
}
