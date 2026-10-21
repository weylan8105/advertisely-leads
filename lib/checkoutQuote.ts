import { leadPackages } from "@/data/packages";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { availableForPackage, GENERATED_TO_ORDER } from "@/lib/inventory";
import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { priceCart, type PricedCart } from "@/lib/referralPricing";
import { findCodeOwner, isAdminRole } from "@/lib/referral";

export interface CartLine {
  packageId: string;
  quantity: number;
}
export interface CheckoutBody {
  // Multi-item cart checkout.
  items?: CartLine[];
  filterStates?: string[];
  // Optional: deliver these leads to a downline agent on the buyer's team.
  deliverToUserId?: string | null;
  // Advertisely Bucks Marketing Campaign (draft): someone's code, and whether to spend Bucks.
  referralCode?: string | null;
  useBucks?: boolean;
  // Legacy single-item fields (still accepted).
  packageId?: string;
  quantity?: number;
}

export type CheckoutQuote =
  | { ok: false; status: number; body: Record<string, unknown> }
  | {
      ok: true;
      validated: CartLine[];
      priced: PricedCart;
      filterStates: string[];
      deliverToUserId: string;
      referral: { code: string; ownerId: string } | null;
    };

const fail = (body: Record<string, unknown>, status: number): CheckoutQuote => ({ ok: false, status, body });

/**
 * Validate a cart and price it. Shared by the Stripe intent route and the
 * Bucks-only order route so both apply identical rules.
 */
export async function quoteCheckout(buyer: { id: string; role?: string }, body: CheckoutBody): Promise<CheckoutQuote> {
  // Normalize to a list of cart lines (accept the legacy single-item body too).
  const rawLines: CartLine[] =
    body.items && body.items.length > 0
      ? body.items
      : body.packageId
        ? [{ packageId: body.packageId, quantity: Number(body.quantity) }]
        : [];
  if (rawLines.length === 0) return fail({ error: "Your cart is empty" }, 400);

  const validated: CartLine[] = [];
  for (const line of rawLines) {
    const pkg = leadPackages.find((p) => p.id === line.packageId && !p.hidden);
    if (!pkg) return fail({ error: `Unknown package: ${line.packageId}` }, 400);
    if (!pkg.available) return fail({ error: `${pkg.name} is coming soon — pricing pending.` }, 400);
    const qty = Number(line.quantity);
    if (!Number.isInteger(qty) || qty < pkg.minimumOrder) {
      return fail({ error: `${pkg.name}: minimum order is ${pkg.minimumOrder} leads.` }, 400);
    }
    validated.push({ packageId: pkg.id, quantity: qty });
  }

  // ── Inventory cap ────────────────────────────────────────────────
  // Never let an order exceed what's actually available for the selected
  // states. Fresh (<48h) is generated-to-order and exempt. Requested
  // quantities are summed per tier in case a cart has the tier twice.
  const filterStates = (body.filterStates ?? []).map((s) => String(s).toUpperCase()).filter(Boolean);
  if (isDatabaseConfigured) {
    const reqByPkg = new Map<string, number>();
    for (const v of validated) reqByPkg.set(v.packageId, (reqByPkg.get(v.packageId) ?? 0) + v.quantity);
    for (const [pid, qty] of reqByPkg) {
      if (GENERATED_TO_ORDER.has(pid)) continue; // fresh: sellable ahead of stock
      const avail = await availableForPackage(pid, filterStates);
      if (qty > avail) {
        const pkg = leadPackages.find((p) => p.id === pid);
        const scope = filterStates.length ? ` in the selected states (${filterStates.join(", ")})` : "";
        return fail(
          {
            error:
              avail > 0
                ? `Only ${avail} ${pkg?.name ?? pid} lead${avail === 1 ? "" : "s"} are available${scope} right now. Lower that tier to ${avail} or fewer.`
                : `${pkg?.name ?? pid} is out of stock${scope} right now. Remove it or pick another age tier.`,
            packageId: pid,
            available: avail,
          },
          409,
        );
      }
    }
  }

  // Optional: deliver to a downline agent. Directing an order to someone else is
  // a team-management action, so require the buyer to be an OWNER/ADMIN, and the
  // target must be a member of THEIR OWN team — one team can never direct leads
  // into another team.
  let deliverToUserId = "";
  if (body.deliverToUserId && prisma) {
    const ctx = await ensureOrgContext(buyer.id);
    if (!ctx || !canManageTeam(ctx.role)) {
      return fail({ error: "Only a team owner or admin can order for a downline agent." }, 403);
    }
    const member = await prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId: ctx.organizationId, userId: body.deliverToUserId } },
      select: { id: true },
    });
    if (!member) return fail({ error: "That agent isn't on your team." }, 400);
    deliverToUserId = body.deliverToUserId;
  }

  // Advertisely Bucks Marketing Campaign (draft). Off → plain list pricing, exactly as before.
  let referral: { code: string; ownerId: string } | null = null;
  let bucksAvailableCents = 0;
  if (REFERRAL_PROGRAM_ENABLED && prisma) {
    if (body.referralCode) {
      const owner = await findCodeOwner(body.referralCode);
      if (!owner?.referralCode) return fail({ error: "That referral code doesn't exist.", badCode: true }, 400);
      if (owner.id === buyer.id) return fail({ error: "You can't use your own referral code.", badCode: true }, 400);
      referral = { code: owner.referralCode, ownerId: owner.id };
    }
    if (body.useBucks && !isAdminRole(buyer.role)) {
      bucksAvailableCents = (await prisma.user.findUnique({ where: { id: buyer.id }, select: { bucksCents: true } }))?.bucksCents ?? 0;
    }
  }
  const priced = priceCart(validated, {
    codeApplied: !!referral,
    bucksAvailableCents,
    useBucks: !!body.useBucks && bucksAvailableCents > 0,
  });

  return { ok: true, validated, priced, filterStates, deliverToUserId, referral };
}
