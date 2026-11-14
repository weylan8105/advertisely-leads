import { prisma } from "./prisma";
import { leadOrigin, ADVERTISER_NAME_KEY } from "./leadOrigin";
import { getAdSpendSummary, forgetAdSpendSummary, SHARED_LEAD_METHOD } from "./adSpend";
import { deliverLeadToOwner } from "./house";
import { HOUSE_EMAIL } from "./housePause";

// ─── Shared lead pool (owner directive, Nov 13 2026) ─────────────────────────
// Only two lead sources come in at a reasonable price: the Enhanced Wealth page
// (Blue Collar instant forms) and the ABCA "Lead Purchase / Team Use" quiz
// campaign. So both now feed ONE per-state round-robin that includes, next to
// the buyers with open orders (and the admin / guest slots already there),
// every Advertisely advertiser client with ad budget left (Jace, David, Angelo).
//
// A client's turn delivers the lead exactly like their own campaign does
// (deliverLeadToOwner: their name on the card, their team routing, Ringy,
// email) and takes that source campaign's cost per lead out of their ad-spend
// balance, so their dashboard stays accurate. The charge is an AdSpendPayment
// row with a negative amount and method "shared-lead" (no schema change);
// lib/adSpend.ts counts those as spend, not as payments.
//
// Enhanced Wealth page leads no longer go house-only while this is on; one no
// one in the rotation can take still falls back to the house (unless
// HOUSE_PAUSE holds it in the bank).
//
// TO TURN IT OFF: set `enabled: false` below and deploy. Routing goes back to
// what it was; leads and charges already made stay as they are.
export const SHARED_POOL = {
  enabled: true,
};

export type SharedPool = "abca" | "ew";

// Source campaign per pool: its last-7-day cost per lead is what a client pays.
export const SHARED_POOL_CAMPAIGNS: Record<SharedPool, { id: string; label: string; fallbackCplCents: number }> = {
  abca: { id: "120250442615980207", label: "ABCA landing page", fallbackCplCents: 2045 },
  ew: { id: "120245300016060396", label: "Enhanced Wealth Blue Collar", fallbackCplCents: 3228 },
};

type PoolLead = {
  source: string | null;
  rawFormData: unknown;
  campaignName?: string | null;
  packageId?: string | null;
};

/** Which shared pool a lead belongs to, or null. */
export function sharedPoolOf(lead: PoolLead): SharedPool | null {
  const src = (lead.source ?? "").toLowerCase();
  if (src.includes("early-retirement-quiz")) return "abca";
  const raw = (lead.rawFormData && typeof lead.rawFormData === "object" ? lead.rawFormData : {}) as Record<string, unknown>;
  if (String(raw[ADVERTISER_NAME_KEY] ?? "").trim()) return null; // a client's own campaign lead
  if (leadOrigin(lead.source, lead.rawFormData) !== "import") return null;
  if ((lead.packageId ?? "blue-collar-iul") !== "blue-collar-iul") return null; // nurses stay out
  if (/ewws|essential workers/i.test(lead.campaignName ?? "")) return null; // EWWS page, not Enhanced Wealth
  return "ew";
}

// ── Cost per lead, from Meta (last 7 days), cached for an hour ──────────────
const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const READ_TOKEN = process.env.META_ADS_ACCESS_TOKEN || process.env.META_ADS_MANAGE_TOKEN;
const cplCache = new Map<SharedPool, { at: number; cents: number }>();

/** Spend ÷ leads from a Meta insights row; null when there is nothing to divide. */
export function cplFromInsights(row: { spend?: string; actions?: { action_type: string; value: string }[] } | undefined): number | null {
  if (!row) return null;
  const spend = Math.round(parseFloat(row.spend ?? "0") * 100);
  const acts = row.actions ?? [];
  const pick = (t: string) => Number(acts.find((a) => a.action_type === t)?.value ?? 0);
  const leads = pick("lead") || pick("offsite_conversion.fb_pixel_lead") || pick("onsite_conversion.lead_grouped");
  if (!spend || !leads) return null;
  return Math.round(spend / leads);
}

export async function sharedCplCents(pool: SharedPool): Promise<number> {
  const c = SHARED_POOL_CAMPAIGNS[pool];
  const hit = cplCache.get(pool);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.cents;
  let cents = c.fallbackCplCents;
  if (READ_TOKEN) {
    try {
      const res = await fetch(
        `${GRAPH}/${c.id}/insights?fields=spend,actions&date_preset=last_7d&access_token=${encodeURIComponent(READ_TOKEN)}`,
        { cache: "no-store" },
      );
      const j = await res.json();
      cents = cplFromInsights(j?.data?.[0]) ?? c.fallbackCplCents;
    } catch (e) {
      console.warn("[shared pool] CPL read failed", e);
    }
  }
  cplCache.set(pool, { at: Date.now(), cents });
  return cents;
}

// ── Client slots ────────────────────────────────────────────────────────────
// Owner request (Nov 13 2026): these clients get FREE leads (no charge, but
// counted on their dashboard as their leads) while their average cost per lead
// is above the target; at or below it, leads are charged per lead as usual.
// Applies to their shared-pool turns and to guest turns billed to them
// (lib/tempRotationGuest.ts). Empty the list to stop it.
export const FREE_UNTIL_CPL = {
  targetCents: 3500,
  emails: ["dclayton1235@gmail.com", "angeloo.rodriguez05@gmail.com"],
};

/** Does this client's dashboard cost per lead sit above the target (so the next lead is free)? */
export function needsFreeLeads(
  s: { costPerLeadCents: number | null; spendCents: number; leads: number },
  targetCents = FREE_UNTIL_CPL.targetCents,
): boolean {
  if (s.leads <= 0) return s.spendCents > 0;
  return (s.costPerLeadCents ?? 0) > targetCents;
}

export function isFreeUntilCplClient(email: string | null | undefined): boolean {
  return FREE_UNTIL_CPL.emails.includes((email ?? "").trim().toLowerCase());
}

export type ClientSlot = { userId: string; name: string; cplCents: number; free?: boolean };

export function licensedIn(states: string[], state: string | null): boolean {
  return states.length === 0 || (!!state && states.includes(state));
}

/**
 * Advertiser clients who can take this lead: ad budget left for one lead at the
 * pool's cost (on a balance read without errors), and someone licensed in the
 * state — the client, or a teammate in their rotation who'd receive it.
 */
export async function sharedClientSlots(state: string | null, pool: SharedPool): Promise<ClientSlot[]> {
  if (!prisma) return [];
  const cplCents = await sharedCplCents(pool);
  const clients = await prisma.user.findMany({
    where: { isAdvertiser: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, name: true, email: true, licensedStates: true,
      ownedOrganizations: {
        select: { memberships: { where: { inRotation: true }, select: { user: { select: { licensedStates: true } } } } },
      },
    },
  });
  const out: ClientSlot[] = [];
  for (const c of clients) {
    if ((c.email ?? "").trim().toLowerCase() === HOUSE_EMAIL) continue; // the house isn't a client
    const teamLicensed = c.ownedOrganizations.some((o) => o.memberships.some((m) => licensedIn(m.user.licensedStates ?? [], state)));
    if (!licensedIn(c.licensedStates ?? [], state) && !teamLicensed) continue;
    const s = await getAdSpendSummary(c.id).catch(() => null);
    if (!s || s.errors.length) continue;
    // Free while their cost per lead is above the target (no balance needed).
    if (isFreeUntilCplClient(c.email) && needsFreeLeads(s)) {
      out.push({ userId: c.id, name: c.name?.trim() || c.email, cplCents: 0, free: true });
      continue;
    }
    if (s.balanceCents < cplCents) continue;
    out.push({ userId: c.id, name: c.name?.trim() || c.email, cplCents });
  }
  return out;
}

/** Deliver a shared lead to a client and charge their ad budget. */
export async function deliverSharedLeadToClient(leadId: string, slot: ClientSlot, pool: SharedPool): Promise<boolean> {
  if (!prisma) return false;
  const label = SHARED_POOL_CAMPAIGNS[pool].label;
  const cost = (slot.cplCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const ok = await deliverLeadToOwner(
    leadId,
    slot.userId,
    slot.free
      ? `Shared ${label} round-robin — free lead (no charge) while the cost per lead is above $${FREE_UNTIL_CPL.targetCents / 100}.`
      : `Shared ${label} round-robin — ${cost} cost per lead taken from the ad-spend balance.`,
    { skipTeamFunding: true },
  );
  if (!ok) return false;
  if (slot.free) {
    forgetAdSpendSummary(slot.userId); // the new lead lowers their cost per lead
    return true;
  }
  await prisma.adSpendPayment.create({
    data: {
      userId: slot.userId,
      amountCents: -slot.cplCents,
      method: SHARED_LEAD_METHOD,
      note: `Shared ${label} lead ${leadId}`,
    },
  });
  forgetAdSpendSummary(slot.userId);
  return true;
}
// ─── end shared lead pool ─────────────────────────────────────────────────────
