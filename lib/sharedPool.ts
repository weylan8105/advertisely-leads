import { prisma } from "./prisma";
import { leadOrigin, ADVERTISER_NAME_KEY } from "./leadOrigin";
import { getAdSpendSummary, forgetAdSpendSummary, SHARED_LEAD_METHOD } from "./adSpend";
import { deliverLeadToOwner } from "./house";
import { HOUSE_EMAIL, isHouseUser } from "./housePause";
import { NURSE_LEAD_TYPE } from "./leadTypes";
import { programLeadPriceCents } from "./advertiserProgram";

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

// "nurse" (Nov 16 2026): nurse / healthcare leads from our Essential Workers
// (EWWS) and HWA campaigns, shared only with advertisers who turned on Nurse
// leads on their dashboard (User.leadTypes, lib/leadTypes.ts).
export type SharedPool = "abca" | "ew" | "nurse";

// Source campaign per pool: its last-7-day cost per lead is what a client pays.
// A pool can draw from more than one campaign; its cost per lead is their combined spend ÷ leads.
export const SHARED_POOL_CAMPAIGNS: Record<SharedPool, { ids: string[]; label: string; fallbackCplCents: number }> = {
  abca: { ids: ["120250442615980207"], label: "ABCA landing page", fallbackCplCents: 2045 },
  ew: { ids: ["120245300016060396"], label: "Enhanced Wealth Blue Collar", fallbackCplCents: 3228 },
  // EWWS - Nurses: "Closed Deals" (lifetime $17.59/lead) and "Conversion Leads".
  nurse: { ids: ["120249692494360601", "120249710458100601"], label: "Nurse", fallbackCplCents: 1759 },
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
  if (lead.packageId === NURSE_LEAD_TYPE && !/^\s*advertisely advertiser/i.test(lead.campaignName ?? "")) return "nurse";
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

type InsightsRow = { spend?: string; actions?: { action_type: string; value: string }[] };

/** Several campaigns' insights rows added together (spend and each action). */
export function combineInsights(rows: (InsightsRow | undefined)[]): InsightsRow | undefined {
  const present = rows.filter((r): r is InsightsRow => !!r);
  if (present.length <= 1) return present[0];
  let spend = 0;
  const acts = new Map<string, number>();
  for (const r of present) {
    spend += parseFloat(r.spend ?? "0") || 0;
    for (const a of r.actions ?? []) acts.set(a.action_type, (acts.get(a.action_type) ?? 0) + (Number(a.value) || 0));
  }
  return { spend: spend.toFixed(2), actions: [...acts].map(([action_type, v]) => ({ action_type, value: String(v) })) };
}

export async function sharedCplCents(pool: SharedPool): Promise<number> {
  const c = SHARED_POOL_CAMPAIGNS[pool];
  const hit = cplCache.get(pool);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.cents;
  let cents = c.fallbackCplCents;
  if (READ_TOKEN) {
    try {
      const rows = await Promise.all(
        c.ids.map(async (id) => {
          const res = await fetch(
            `${GRAPH}/${id}/insights?fields=spend,actions&date_preset=last_7d&access_token=${encodeURIComponent(READ_TOKEN)}`,
            { cache: "no-store" },
          );
          const j = await res.json();
          return j?.data?.[0];
        }),
      );
      cents = cplFromInsights(combineInsights(rows)) ?? c.fallbackCplCents;
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

export type ClientSlot = { userId: string; name: string; cplCents: number; free?: boolean; program?: boolean };

/**
 * What a client pays for one shared lead: the pool's cost per lead, plus the
 * 20% management fee and the card fee for Advertiser Program members
 * (lib/advertiserProgram.ts).
 */
export function clientLeadPriceCents(poolCplCents: number, s: { program: { member: boolean } }): number {
  return s.program.member ? programLeadPriceCents(poolCplCents) : poolCplCents;
}

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
      id: true, name: true, email: true, licensedStates: true, leadTypes: true,
      ownedOrganizations: {
        select: { memberships: { where: { inRotation: true }, select: { user: { select: { licensedStates: true } } } } },
      },
    },
  });
  const licensed = clients.filter((c) => {
    if ((c.email ?? "").trim().toLowerCase() === HOUSE_EMAIL) return false; // the house isn't a client
    if (pool === "nurse" && !(c.leadTypes ?? []).includes(NURSE_LEAD_TYPE)) return false; // Nurse leads are opt-in
    const teamLicensed = c.ownedOrganizations.some((o) => o.memberships.some((m) => licensedIn(m.user.licensedStates ?? [], state)));
    return licensedIn(c.licensedStates ?? [], state) || teamLicensed;
  });
  // Read every balance at once: with more clients in the pool, one at a time
  // would hold up the lead that's waiting to be routed.
  const summaries = await Promise.all(licensed.map((c) => getAdSpendSummary(c.id).catch(() => null)));
  const out: ClientSlot[] = [];
  for (const [i, c] of licensed.entries()) {
    const s = summaries[i];
    if (!s || s.errors.length) continue;
    // Past their November cover, or their membership has ended: nothing until they join the Advertiser Program.
    if (s.program.mustJoin) continue;
    // Free while their cost per lead is above the target (no balance needed).
    if (isFreeUntilCplClient(c.email) && needsFreeLeads(s)) {
      out.push({ userId: c.id, name: c.name?.trim() || c.email, cplCents: 0, free: true });
      continue;
    }
    const price = clientLeadPriceCents(cplCents, s);
    if (s.balanceCents < price) continue;
    out.push({ userId: c.id, name: c.name?.trim() || c.email, cplCents: price, ...(s.program.member ? { program: true } : {}) });
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
      : `Shared ${label} round-robin — ${cost}${slot.program ? " (cost per lead + 20% management + 3% card fee)" : " cost per lead"} taken from the ad-spend balance.`,
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
/**
 * A nurse lead from a form the house (Ryan) owns goes to the shared nurse pool
 * instead of being delivered to him (owner request, Nov 16 2026).
 */
export async function isHouseNurseLead(ownerUserId: string | null | undefined, packageId: string | null | undefined): Promise<boolean> {
  return SHARED_POOL.enabled && packageId === NURSE_LEAD_TYPE && (await isHouseUser(ownerUserId));
}
// ─── end shared lead pool ─────────────────────────────────────────────────────
