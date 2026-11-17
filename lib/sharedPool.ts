import { prisma } from "./prisma";
import { leadOrigin, ADVERTISER_NAME_KEY } from "./leadOrigin";
import { getAdSpendSummary, forgetAdSpendSummary, SHARED_LEAD_METHOD } from "./adSpend";
import { deliverLeadToOwner } from "./house";
import { HOUSE_EMAIL, isHouseUser } from "./housePause";
import { NURSE_LEAD_TYPE, BLUE_COLLAR_LEAD_TYPE, leadTypeOn } from "./leadTypes";
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

// Lead types (Nov 16 2026, lib/leadTypes.ts): an advertiser only gets a pool's
// leads when its type is on for them (dashboard "Lead types"). Blue Collar is
// on unless switched off; Nurse is off unless switched on.
//  - "ewws":  Blue Collar leads from the Essential Workers (EWWS) ad account
//  - "nurse": nurse / healthcare leads (EWWS Nurses, HWA quiz)
// These two go ONLY to advertisers with the type on: no marketplace orders,
// admin overflow, rotation guests or replacements (see TOGGLE_ONLY_POOLS).
export type SharedPool = "abca" | "ew" | "ewws" | "nurse";

/** Pools that go only to advertisers who switched the lead type on. */
export const TOGGLE_ONLY_POOLS: ReadonlySet<SharedPool> = new Set<SharedPool>(["ewws", "nurse"]);

/** The lead type an advertiser must have on to take a pool's leads. */
export const poolLeadType = (pool: SharedPool) => (pool === "nurse" ? NURSE_LEAD_TYPE : BLUE_COLLAR_LEAD_TYPE);

// Main campaign(s) per pool. The price now comes from every house campaign in the
// pool's ad account (SHARED_POOL_ACCOUNTS below); these ids are only the fallback
// when the account can't be read, plus how Essential Workers leads are told apart.
// A client pays the last 72 hours' cost per lead, never less than MIN_SHARED_CPL_CENTS.
export const SHARED_POOL_CAMPAIGNS: Record<SharedPool, { ids: string[]; label: string; fallbackCplCents: number }> = {
  abca: { ids: ["120250442615980207"], label: "ABCA landing page", fallbackCplCents: 2045 },
  ew: { ids: ["120245300016060396"], label: "Enhanced Wealth Blue Collar", fallbackCplCents: 3228 },
  // EWWS - Blue Collar: "Closed Deals" (lifetime $92.70/lead) and "Conversion Leads".
  ewws: { ids: ["120249692494140601", "120249710458680601"], label: "Essential Workers Blue Collar", fallbackCplCents: 9270 },
  // EWWS - Nurses: "Closed Deals" (lifetime $17.59/lead) and "Conversion Leads".
  nurse: { ids: ["120249692494360601", "120249710458100601"], label: "Nurse", fallbackCplCents: 1759 },
};

const EWWS_NAME = /^\s*ewws\b|essential workers/i;

// ── Every house campaign counts toward the price (owner, Nov 17 2026) ──────────
// "All of the testing campaigns (as well as ones that are not generating leads)
// need to be factored into our clients' cost per lead." So a pool's price is the
// spend of EVERY campaign in its ad account, not just the main campaign above:
// tests, paused campaigns that still spent in the window, and campaigns with no
// leads all count. Clients' own campaigns ("Advertisely Advertiser - …" or a
// client's User.adCampaignIds) are left out, because those are billed to that
// client's budget directly. The Essential Workers account holds two pools: nurse
// campaigns (name has "nurse") price the nurse pool, the rest price Blue Collar.
export const SHARED_POOL_ACCOUNTS: Record<SharedPool, { account: string; nurse?: boolean }> = {
  abca: { account: "2126340781245705" }, // American Blue Collar Advantage
  ew: { account: "2254810101392917" }, // Enhanced Wealth
  ewws: { account: "1270766111922960", nurse: false }, // Essential Workers Wealth Solutions
  nurse: { account: "1270766111922960", nurse: true },
};
// Campaigns in those accounts that are NOT lead generation for the pools (e.g. a
// recruiting or brand campaign), matched by name. Empty: everything counts.
export const NOT_POOL_CAMPAIGNS: RegExp[] = [];
const EWWS_CAMPAIGN_IDS = new Set([...SHARED_POOL_CAMPAIGNS.ewws.ids, ...SHARED_POOL_CAMPAIGNS.nurse.ids]);
const NURSE_CAMPAIGN_IDS = new Set(SHARED_POOL_CAMPAIGNS.nurse.ids);

/** The Meta campaign id a form lead kept in its raw data, if any. */
function rawCampaignId(raw: unknown): string | null {
  try {
    return JSON.stringify(raw ?? {}).match(/campaignId[^0-9]{1,12}([0-9]{10,})/)?.[1] ?? null;
  } catch {
    return null;
  }
}

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
  if (/^\s*advertisely advertiser/i.test(lead.campaignName ?? "")) return null; // a client's campaign
  // Essential Workers ad account: by campaign id (some leads keep only that) or "EWWS - …" name.
  const campaignId = rawCampaignId(lead.rawFormData);
  const ewws = (!!campaignId && EWWS_CAMPAIGN_IDS.has(campaignId)) || EWWS_NAME.test(lead.campaignName ?? "");
  const nurseCampaign = (!!campaignId && NURSE_CAMPAIGN_IDS.has(campaignId)) || (ewws && /nurse/i.test(lead.campaignName ?? ""));
  if (lead.packageId === NURSE_LEAD_TYPE || nurseCampaign) return "nurse";
  if (ewws) return (lead.packageId ?? BLUE_COLLAR_LEAD_TYPE) === BLUE_COLLAR_LEAD_TYPE ? "ewws" : null;
  if (leadOrigin(lead.source, lead.rawFormData) !== "import") return null;
  if ((lead.packageId ?? "blue-collar-iul") !== "blue-collar-iul") return null; // nurses stay out
  return "ew";
}

// ── Cost per lead, from Meta, cached for an hour ────────────────────────────
// Owner directive (Nov 17 2026): charge what we are paying NOW, the last 72
// hours, not a longer average; and never less than $20 a lead. Meta reports by
// day, so "the last 72 hours" is its last 3 full days plus today so far. A pool
// with no leads in that window uses its last 7 days, then the fixed fallback.
// The spend is divided by the leads that actually reached the CRM in that window
// when that is fewer than Meta counted (Nov 17 2026: Meta counted 153 Enhanced
// Wealth leads over five days, 141 arrived, so clients were paying under cost).
export const MIN_SHARED_CPL_CENTS = 2000;
const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;
const READ_TOKEN = process.env.META_ADS_ACCESS_TOKEN || process.env.META_ADS_MANAGE_TOKEN;
const cplCache = new Map<SharedPool, { at: number; cents: number }>();

/**
 * Spend ÷ leads from a Meta insights row; null when there is nothing to divide.
 * `arrivedLeads` is how many of those leads actually reached the CRM: Meta counts
 * some that never arrive (repeat submissions, drops), and dividing by its higher
 * number charges clients less than the campaign cost. So the spend is never
 * divided by more leads than arrived. 0 / null = unknown, use Meta's count; so
 * does an arrived count under ARRIVED_TRUST_RATIO of Meta's.
 */
export const ARRIVED_TRUST_RATIO = 0.75;
export function cplFromInsights(
  row: { spend?: string; actions?: { action_type: string; value: string }[] } | undefined,
  arrivedLeads?: number | null,
): number | null {
  if (!row) return null;
  const spend = Math.round(parseFloat(row.spend ?? "0") * 100);
  const acts = row.actions ?? [];
  const pick = (t: string) => Number(acts.find((a) => a.action_type === t)?.value ?? 0);
  const metaLeads = pick("lead") || pick("offsite_conversion.fb_pixel_lead") || pick("onsite_conversion.lead_grouped");
  // A count far below Meta's means our own count is off (an intake outage, say), not the price.
  const trustArrived = !!arrivedLeads && arrivedLeads > 0 && arrivedLeads >= metaLeads * ARRIVED_TRUST_RATIO;
  const leads = trustArrived ? Math.min(metaLeads, arrivedLeads!) : metaLeads;
  if (!spend || !leads) return null;
  return Math.round(spend / leads);
}

type InsightsRow = { spend?: string; actions?: { action_type: string; value: string }[] };
type CampaignInsightsRow = InsightsRow & { campaign_id?: string; campaign_name?: string };

/**
 * One pool's share of its ad account's campaign rows, added together: every
 * campaign except clients' own (by name or their campaign ids) and NOT_POOL_CAMPAIGNS,
 * split nurse / not nurse on the Essential Workers account.
 */
export function poolSpendRow(
  pool: SharedPool,
  rows: CampaignInsightsRow[],
  clientCampaignIds: ReadonlySet<string> = new Set(),
): InsightsRow | undefined {
  const { nurse } = SHARED_POOL_ACCOUNTS[pool];
  const kept = rows.filter((r) => {
    const name = r.campaign_name ?? "";
    if (/^\s*advertisely advertiser/i.test(name)) return false;
    if (r.campaign_id && clientCampaignIds.has(r.campaign_id)) return false;
    if (NOT_POOL_CAMPAIGNS.some((re) => re.test(name))) return false;
    if (nurse === undefined) return true;
    const isNurse = /nurse/i.test(name) || (!!r.campaign_id && NURSE_CAMPAIGN_IDS.has(r.campaign_id));
    return isNurse === nurse;
  });
  const sum = combineInsights(kept.map(({ spend, actions }) => ({ spend, actions })));
  return sum ?? (rows.length ? { spend: "0", actions: [] } : undefined);
}

/** Campaign ids that belong to clients (billed to their own budget), from User.adCampaignIds. */
async function clientCampaignIdSet(): Promise<Set<string>> {
  if (!prisma) return new Set();
  try {
    const users = await prisma.user.findMany({
      where: { adCampaignIds: { isEmpty: false } },
      select: { adCampaignIds: true },
    });
    return new Set(users.flatMap((u: { adCampaignIds?: string[] }) => u.adCampaignIds ?? []));
  } catch {
    return new Set();
  }
}

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

/**
 * A pool's cost per lead: the last 72 hours when it has leads, else the last 7
 * days, else the fallback; never below the minimum.
 */
export function recentCplCents(
  recent: (InsightsRow | undefined)[],
  week: InsightsRow | undefined,
  fallbackCents: number,
  arrivedLeads?: number | null,
): number {
  const cents = cplFromInsights(combineInsights(recent), arrivedLeads) ?? cplFromInsights(week) ?? fallbackCents;
  return Math.max(cents, MIN_SHARED_CPL_CENTS);
}

/** Midnight at the start of the day `daysAgo` days back, in the ad accounts' reporting time zone. */
export function pricingWindowStart(now = new Date(), daysAgo = 3, tz = "America/Chicago"): Date {
  const ymd = new Date(now.getTime() - daysAgo * 86_400_000).toLocaleDateString("en-CA", { timeZone: tz });
  const noon = new Date(`${ymd}T12:00:00Z`);
  const offsetMs =
    new Date(noon.toLocaleString("en-US", { timeZone: "UTC" })).getTime() -
    new Date(noon.toLocaleString("en-US", { timeZone: tz })).getTime();
  return new Date(new Date(`${ymd}T00:00:00Z`).getTime() + offsetMs);
}

/**
 * A delivered lead carries the client's name (deliverLeadToOwner), which makes
 * sharedPoolOf read it as that client's own campaign lead. Drop the stamp to see
 * which pool it arrived in.
 */
export function withoutClientStamp(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { [ADVERTISER_NAME_KEY]: _stamp, ...rest } = raw as Record<string, unknown>;
  return rest;
}

/**
 * How many of a pool's leads reached the CRM in the pricing window (Meta's
 * last 3 full days plus today). Null when it can't be read.
 */
export async function arrivedPoolLeads(pool: SharedPool): Promise<number | null> {
  if (!prisma) return null;
  try {
    const rows = await prisma.lead.findMany({
      where: { receivedAt: { gte: pricingWindowStart() }, trashedAt: null },
      select: { source: true, rawFormData: true, campaignName: true, packageId: true },
    });
    return rows.filter((l) => sharedPoolOf({ ...l, rawFormData: withoutClientStamp(l.rawFormData) }) === pool).length;
  } catch (e) {
    console.warn("[shared pool] arrived-lead count failed", e);
    return null;
  }
}

export async function sharedCplCents(pool: SharedPool): Promise<number> {
  const c = SHARED_POOL_CAMPAIGNS[pool];
  const hit = cplCache.get(pool);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.cents;
  let cents = Math.max(c.fallbackCplCents, MIN_SHARED_CPL_CENTS);
  if (READ_TOKEN) {
    const clientIds = await clientCampaignIdSet();
    // Every house campaign in the pool's ad account for one Meta date preset (see
    // SHARED_POOL_ACCOUNTS). Null when the account can't be read.
    const readAccount = async (preset: string): Promise<InsightsRow | undefined | null> => {
      const res = await fetch(
        `${GRAPH}/act_${SHARED_POOL_ACCOUNTS[pool].account}/insights?level=campaign&fields=campaign_id,campaign_name,spend,actions&limit=500&date_preset=${preset}&access_token=${encodeURIComponent(READ_TOKEN)}`,
        { cache: "no-store" },
      );
      const j = await res.json();
      if (!res.ok || j?.error || !Array.isArray(j?.data)) {
        console.warn("[shared pool] account read failed", pool, j?.error?.message);
        return null;
      }
      return poolSpendRow(pool, j.data as CampaignInsightsRow[], clientIds);
    };
    // Fallback when the account can't be read: the pool's main campaigns only.
    const readCampaigns = async (preset: string) =>
      combineInsights(
        await Promise.all(
          c.ids.map(async (id) => {
            const res = await fetch(
              `${GRAPH}/${id}/insights?fields=spend,actions&date_preset=${preset}&access_token=${encodeURIComponent(READ_TOKEN)}`,
              { cache: "no-store" },
            );
            const j = await res.json();
            return j?.data?.[0] as InsightsRow | undefined;
          }),
        ),
      );
    const read = async (preset: string) => {
      const all = await readAccount(preset);
      return all === null ? readCampaigns(preset) : all;
    };
    try {
      const [last3, today, arrived] = await Promise.all([read("last_3d"), read("today"), arrivedPoolLeads(pool)]);
      const recent = [last3, today];
      // Only ask for the week when the last 72 hours had no leads to price from.
      const week = cplFromInsights(combineInsights(recent)) === null ? await read("last_7d") : undefined;
      cents = recentCplCents(recent, week, c.fallbackCplCents, arrived);
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
    if (!leadTypeOn(c.leadTypes, poolLeadType(pool))) return false; // they switched this lead type off (or never on)
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
 * An Essential Workers lead (Blue Collar or Nurse) from a form the house (Ryan)
 * owns goes to its shared pool instead of being delivered to him (owner
 * request, Nov 16 2026).
 */
export async function isHouseToggleLead(ownerUserId: string | null | undefined, lead: PoolLead): Promise<boolean> {
  if (!SHARED_POOL.enabled) return false;
  const pool = sharedPoolOf(lead);
  return !!pool && TOGGLE_ONLY_POOLS.has(pool) && (await isHouseUser(ownerUserId));
}
// ─── end shared lead pool ─────────────────────────────────────────────────────
