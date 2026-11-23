import { alertGoldmineTeamOfNewLead } from "./goldmineAlert";
import { prisma } from "./prisma";
import { ensureOrgContext } from "./org";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { appendRows, isSheetsConfigured } from "./sheets";
import { buildExportRows } from "./leadExport";
import { findPackage, leadPoolIdsFor, purchasableIdsForPool } from "@/data/packages";
import { NOT_TEST_LEAD } from "@/lib/testLeads";
import { getHouseAccount, getEligibleAdminSlots, assignOverflowLeadTo } from "@/lib/house";
import { tryReplacementForFreshLead } from "@/lib/replacement";
import { HOLDBACK_TAGS_TO_HOUSE } from "@/lib/flags";
import { isRecognizedUsLocation } from "@/lib/leadImport";
import { goldmineLeadData, planLeadPipelines, type LeadPipeline } from "@/lib/leadDestination";
import { leadOrigin } from "@/lib/leadOrigin";
import { isHousePaused } from "@/lib/housePause";
import { adminLeadFunded } from "@/lib/leadCostLedger";
import { FEWEST_FIRST, fewestFirstOrder, leadsReceivedRecently } from "@/lib/fewestFirst";
import { isClientPaused } from "@/lib/clientPause";
import { SHARED_POOL, TOGGLE_ONLY_POOLS, sharedPoolOf, sharedClientSlots, deliverSharedLeadToClient, poolLeadType, type ClientSlot } from "@/lib/sharedPool";
import { leadTypeOn } from "@/lib/leadTypes";
import {
  TEMP_ROTATION_GUEST,
  routeEwTextVerifiedToGuest,
  getRotationGuests,
  guestLicensedFor,
  isAbcaLandingPageLead,
  assignLeadToGuest,
} from "@/lib/tempRotationGuest";

/**
 * Attempt to fulfill one order by finding unassigned leads matching its filters.
 * Returns the number of leads newly assigned.
 *
 * This runs in two scenarios:
 *  1. Immediately after an order is placed (catch existing inventory).
 *  2. After each Meta webhook insert (assign fresh leads to pending orders).
 */
export async function fulfillOrder(orderId: string, opts: { onlyLeadId?: string } = {}): Promise<number> {
  if (!prisma) return 0;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { leads: { where: { trashedAt: null }, select: { id: true } } },
  });
  if (!order) return 0;
  if (order.status === "DELIVERED" || order.status === "REFUNDED") return 0;
  // CLIENT_PAUSES (lib/clientPause.ts): a client on a dated pause gets nothing
  // new. The order stays open and fills again once the pause is over.
  if (isClientPaused(order.deliverToUserId ?? order.userId)) return 0;

  // Remaining is based on the LIVE count of non-trashed leads actually on the
  // order — not the stored fulfilledCount — so delivery self-heals from any
  // drift (e.g. a lead removed/trashed after the counter was set).
  const liveDelivered = order.leads.length;
  const remaining = order.quantity - liveDelivered;
  if (remaining <= 0) return 0;

  // State is REQUIRED. An order with no states configured must NEVER vacuum up
  // every state — a client only ever receives leads in states they ordered.
  // Deliver nothing until the order has states set (misconfiguration guard).
  if (order.filterStates.length === 0) return 0;

  // Aged buckets carry an age window (days) relative to receivedAt. Translate
  // it into a receivedAt range; null bounds are left open.
  const dayMs = 86_400_000;
  const nowMs = Date.now();
  // ageMaxDays is the exclusive upper edge (shared with the next bucket's
  // ageMinDays) → gt, so adjacent buckets tile with no gap or overlap.
  // Age bounds come from the order; if an order was never stamped, fall back to
  // the package's own age window so a tiered product (e.g. Real-Time = 0–2 days)
  // can NEVER deliver out-of-window leads even on an unstamped order.
  const pkgForAge = findPackage(order.packageId);
  const ageMaxDays = order.filterAgeMaxDays ?? pkgForAge?.ageMaxDays ?? null;
  const ageMinDays = order.filterAgeMinDays ?? pkgForAge?.ageMinDays ?? null;
  const receivedAtFilter: { gt?: Date; lte?: Date } = {};
  if (ageMaxDays != null) receivedAtFilter.gt = new Date(nowMs - ageMaxDays * dayMs);
  if (ageMinDays != null) receivedAtFilter.lte = new Date(nowMs - ageMinDays * dayMs);

  // Find unassigned leads from this order's underlying lead pool, matching its
  // state + income + age filters. Buckets resolve to their pool (e.g. aged-iul).
  const rawCandidates = await prisma.lead.findMany({
    where: {
      packageId: { in: leadPoolIdsFor(order.packageId) },
      assignedUserId: null,
      orderId: null,
      trashedAt: null, // never deliver trashed (replaced/bad) leads
      // Hard state match — an order only ever draws leads in its own states
      // (guaranteed non-empty by the guard above).
      state: { in: order.filterStates },
      ...(order.filterIncomeMin
        ? { income: { gte: order.filterIncomeMin } }
        : {}),
      ...(receivedAtFilter.gt || receivedAtFilter.lte ? { receivedAt: receivedAtFilter } : {}),
      // Never deliver obviously-fake / internal test leads to a buyer.
      ...NOT_TEST_LEAD,
      // Round-robin intake pins a single lead so exactly that one is assigned.
      ...(opts.onlyLeadId ? { id: opts.onlyLeadId } : {}),
    },
    orderBy: { receivedAt: "asc" },
    take: opts.onlyLeadId ? 1 : remaining,
  });

  // Owner directive (Nov 2026): leads from Ryan's own instant-form landing pages
  // — Enhanced Wealth and Essential Workers Wealth Solutions (EWWS) — are
  // house-only and must NEVER be delivered to a buyer order, even straight from
  // the bank (e.g. older unassigned leads or CSV imports). These are exactly the
  // non-quiz "import"-origin leads (lib/leadOrigin); the ABCA / HWA quiz funnels
  // stay sellable.
  // SHARED_POOL (lib/sharedPool.ts): Enhanced Wealth Blue Collar page leads are
  // shared with clients, open orders included, so those stay in. Essential
  // Workers and nurse page leads still never reach an order.
  // HOUSE_PAUSE (lib/housePause.ts): while it is on, every page lead is routed
  // to clients instead, so the filter is lifted.
  const candidates = isHousePaused()
    ? rawCandidates
    : rawCandidates.filter(
        (l) => leadOrigin(l.source, l.rawFormData) !== "import" || (SHARED_POOL.enabled && sharedPoolOf(l) === "ew"),
      );

  if (candidates.length === 0) return 0;

  // ── Destination ────────────────────────────────────────────────────
  // Every lead goes to the buyer (or the downline the order was bought for).
  // On the team owner's own order, their lead destination may put some or all
  // of them in the team's Goldmine instead (lib/leadDestination.ts).
  let orgId = order.organizationId as string | null;
  // Orders created before Phase 1 (or before stamping) may have no org — resolve
  // and persist the buyer's org so scoping works.
  if (!orgId) {
    const ctx = await ensureOrgContext(order.userId);
    orgId = ctx?.organizationId ?? null;
    if (orgId) {
      await prisma.order.update({ where: { id: order.id }, data: { organizationId: orgId } });
    }
  }
  // A member who buys their own leads, or an order routed to a specific downline
  // agent (deliverToUserId), always delivers to that person's own pipeline.
  const routedTo = order.deliverToUserId ?? null;
  const defaultRecipient = routedTo ?? order.userId;
  const plan: LeadPipeline[] = routedTo
    ? candidates.map(() => "main")
    : await planLeadPipelines(orgId, order.userId, candidates.length);
  const pipelineOf = new Map<string, LeadPipeline>(candidates.map((l, i) => [l.id, plan[i] ?? "main"]));
  const assigneeOf = new Map<string, string>(candidates.map((l) => [l.id, defaultRecipient]));

  const now = new Date();
  // Assign in a single transaction so concurrent fulfillment doesn't double-assign
  await prisma.$transaction(async (tx) => {
    for (const pipeline of ["main", "goldmine"] as const) {
      const ids = candidates.filter((l) => pipelineOf.get(l.id) === pipeline).map((l) => l.id);
      if (ids.length === 0) continue;
      await tx.lead.updateMany({
        where: { id: { in: ids }, assignedUserId: null },
        data: {
          assignedUserId: defaultRecipient,
          assignedAt: now,
          orderId: order.id,
          ...(orgId ? { organizationId: orgId } : {}),
          ...(pipeline === "goldmine" && orgId ? goldmineLeadData(orgId, now) : {}),
        },
      });
    }

    // Re-sync the stored counter to the live count + what we just delivered.
    const newFulfilled = liveDelivered + candidates.length;
    await tx.order.update({
      where: { id: order.id },
      data: {
        fulfilledCount: newFulfilled,
        status:
          newFulfilled >= order.quantity
            ? "DELIVERED"
            : newFulfilled > 0
              ? "DELIVERING"
              : order.status,
        fulfilledAt: newFulfilled >= order.quantity ? new Date() : null,
      },
    });

    // Log activity on each assigned lead
    await tx.leadActivity.createMany({
      data: candidates.map((l) => ({
        leadId: l.id,
        type: "LEAD_ASSIGNED" as const,
        body:
          pipelineOf.get(l.id) === "goldmine"
            ? `Lead put in the team Goldmine via order ${order.id} (the owner's lead destination).`
            : `Lead assigned to customer via order ${order.id}.`,
      })),
    });
  });

  // Email EACH recipient exactly the leads that went to THEM — so every
  // notification matches what's actually in that person's CRM (never a
  // teammate's leads, and the routed agent — not the buyer — is the one told).
  if (candidates.length > 0 && isEmailConfigured) {
    try {
      const byRecipient = new Map<string, typeof candidates>();
      for (const l of candidates) {
        // Goldmine leads are the team's, not in anyone's own pipeline: no email.
        if (pipelineOf.get(l.id) === "goldmine") continue;
        const who = assigneeOf.get(l.id) ?? defaultRecipient;
        const arr = byRecipient.get(who) ?? [];
        arr.push(l);
        byRecipient.set(who, arr);
      }
      const pkgName = findPackage(order.packageId)?.name ?? order.packageId;
      for (const [recipientId, theirLeads] of byRecipient) {
        const user = await prisma!.user.findUnique({
          where: { id: recipientId },
          select: { email: true, name: true },
        });
        if (!user?.email) continue;
        await sendLeadDeliveryEmail({
          agentEmail: user.email,
          agentName: user.name ?? "Agent",
          leadCount: theirLeads.length,
          packageName: pkgName,
          orderId: order.id,
          leads: theirLeads.map((l) => ({
            name: l.name,
            phone: l.phone,
            email: l.email,
            state: l.state,
            occupation: l.occupation,
            age: l.age,
            income: l.income,
            intentReason: l.intentReason,
          })),
        });
      }
    } catch (emailErr) {
      // Never block fulfillment on email failure
      console.warn("Email notification failed:", emailErr);
    }
  }

  // Live-sync the newly delivered leads into a Google Sheet. By default this is
  // the customer's connected sheet (all their orders flow there automatically);
  // if this specific order has a per-order sheet override, that wins. Rows use
  // the same columns as CSV export.
  if (candidates.length > 0 && isSheetsConfigured && prisma) {
    try {
      let targetSheetId: string | undefined =
        (order as { sheetOverrideId?: string | null }).sheetOverrideId ?? undefined;
      let integrationId: string | undefined;
      let sheetName = "Sheet1";

      if (!targetSheetId) {
        const integration = await prisma.integration.findUnique({
          where: { userId_type: { userId: order.userId, type: "GOOGLE_SHEETS" } },
        });
        if (integration?.enabled) {
          targetSheetId = (integration.config as any)?.spreadsheetId;
          sheetName = (integration.config as any)?.sheetName ?? "Sheet1";
          integrationId = integration.id;
        }
      }

      if (targetSheetId) {
        const result = await appendRows(
          targetSheetId,
          buildExportRows(candidates),
          sheetName,
        );
        await prisma.exportLog.create({
          data: {
            userId: order.userId,
            destination: "sheets",
            status: result.ok ? "SUCCESS" : "FAILED",
            responseCode: result.status || null,
            errorMessage: result.ok ? null : result.error?.slice(0, 500),
          },
        });
        if (integrationId) {
          await prisma.integration.update({
            where: { id: integrationId },
            data: { lastUsedAt: new Date() },
          });
        }
      }
    } catch (sheetsErr) {
      // Never block fulfillment on a Sheets failure
      console.warn("Google Sheets sync failed:", sheetsErr);
    }
  }

  return candidates.length;
}

/**
 * Triggered after a new lead is inserted. Walks all pending orders that could
 * potentially absorb this lead and tries to fulfill them. Order of operations
 * matters: FIFO by order createdAt.
 */
/**
 * Is this lead within an order's age window? (State is matched by the caller's
 * query.) Falls back to the package's window when the order has no explicit one,
 * mirroring fulfillOrder's own age bounds.
 */
function leadAgeEligibleForOrder(
  order: { packageId: string; filterAgeMinDays: number | null; filterAgeMaxDays: number | null },
  receivedAt: Date,
): boolean {
  const pkg = findPackage(order.packageId);
  const minD = order.filterAgeMinDays ?? pkg?.ageMinDays ?? 0;
  const maxD = order.filterAgeMaxDays ?? pkg?.ageMaxDays ?? null;
  const ageDays = (Date.now() - receivedAt.getTime()) / 86_400_000;
  if (ageDays < minD) return false;
  if (maxD != null && ageDays > maxD) return false;
  return true;
}

/**
 * TEMPORARY testing hold-back (lib/flags.ts HOLDBACK_TAGS_TO_HOUSE). A lead whose
 * tags match a held-back product goes 100% to the house (Ryan) — bypassing all
 * buyer distribution — so its quality can be evaluated before it's sold. Routes
 * regardless of age (these are new test leads) and returns true if it claimed
 * the lead. Clearing the flag array turns this off and resumes distribution.
 */
async function routeHeldBackTagToHouse(lead: { id: string; tags: string[] }): Promise<boolean> {
  if (!prisma || HOLDBACK_TAGS_TO_HOUSE.length === 0) return false;
  if (isHousePaused()) return false; // HOUSE_PAUSE: nothing new goes to Ryan
  const tags = (lead.tags ?? []).map((t) => t.toLowerCase());
  const matched = HOLDBACK_TAGS_TO_HOUSE.find((h) => tags.some((t) => t.includes(h.toLowerCase())));
  if (!matched) return false;
  const house = await getHouseAccount();
  if (!house) return false;
  const res = await prisma.lead.updateMany({
    where: { id: lead.id, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: house.userId,
      assignedAt: new Date(),
      ...(house.organizationId ? { organizationId: house.organizationId } : {}),
    },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: "LEAD_ASSIGNED",
      body: `Held to house for testing (tag "${matched}") — not distributed to buyers.`,
    },
  });
  return true;
}

/**
 * Owner directive (Nov 2026): every lead from Ryan's own instant-form landing
 * pages — Enhanced Wealth and Essential Workers Wealth Solutions (EWWS) — belongs
 * solely to the house (Ryan). They must never reach a buyer order, an overflow
 * admin, or a team round-robin. These pages are exactly the non-quiz,
 * "import"-origin leads the app already labels "Enhanced Wealth Lead"
 * (lib/leadOrigin): Facebook instant-form intake (GHL + Meta webhooks), as
 * opposed to the ABCA (early-retirement-quiz) and HWA (healthcare-wealth-quiz)
 * funnels, which stay in the marketplace. Advertiser-owned leads never reach here
 * — they're delivered to their owner upstream. No age gate: these arrive fresh.
 * Returns true if it claimed the lead (caller then stops distributing).
 */
async function routePageLeadToHouse(lead: {
  id: string;
  source: string | null;
  rawFormData: unknown;
}): Promise<boolean> {
  if (!prisma) return false;
  // HOUSE_PAUSE: while Ryan is away, page leads fall through to the rotation.
  if (isHousePaused()) return false;
  if (leadOrigin(lead.source, lead.rawFormData) !== "import") return false;
  const house = await getHouseAccount();
  if (!house) return false;
  const res = await prisma.lead.updateMany({
    where: { id: lead.id, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: house.userId,
      assignedAt: new Date(),
      ...(house.organizationId ? { organizationId: house.organizationId } : {}),
    },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: "LEAD_ASSIGNED",
      body: "Routed to house CRM — Enhanced Wealth / Essential Workers page lead (owner-only, not distributed to buyers).",
    },
  });
  return true;
}

// How many states the house (Ryan) effectively covers. The house is the
// catch-all for every state, so it has the broadest coverage and therefore the
// weakest per-state claim. Used as the denominator in coverage weighting.
// Tunable: a LARGER value makes the house back off harder from buyers' states
// (buyers keep more of their turf); a smaller value lets the house compete more.
export const HOUSE_COVERAGE_STATES = 50;

/**
 * Coverage-weighted winner for a single lead among the parties competing for its
 * state. The fairness principle: a party that covers FEWER states should get a
 * LARGER share of each of those states — otherwise a narrow buyer is squeezed
 * twice (fewer states AND those few states split away), while a broad party
 * (many states, or the all-states house) accumulates by default.
 *
 * Each party's weight = 1 / (states it covers); its target share of this state =
 * weight / Σweights. The winner is the party currently furthest BELOW its target
 * (largest-remainder), so repeated calls converge to the weighted shares. Broad
 * parties still win on TOTAL volume (they're in many states) but stop dominating
 * a narrow buyer's home turf. Pure function so the projection tool and
 * production share identical math.
 */
export function coverageWeightedWinner(
  parties: { coverage: number; count: number }[],
): number {
  const weights = parties.map((p) => 1 / Math.max(1, p.coverage));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const total = parties.reduce((a, p) => a + p.count, 0);
  let best = 0;
  let bestDeficit = -Infinity;
  parties.forEach((p, i) => {
    const target = weights[i] / sumW;
    const deficit = target * (total + 1) - p.count;
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = i;
    }
  });
  return best;
}

// ── House overflow skip-credit (owner directive, Oct 2026) ────────────────
// When a lead in a RECOGNIZED state that no buyer order covers is routed to the
// house, Ryan gets the lead "for free" — so it banks a credit that skips his
// next turn in a covered-state round-robin (the buyer gets that lead instead),
// keeping his total take fair. A TRASH lead (unrecognizable state) routed to
// the house banks NO credit — he keeps his normal turns. Stored as a single
// counter in the existing DistributionCursor table (no schema change). Low
// lead volume makes the read-modify-write race immaterial, same as the cursor.
const HOUSE_SKIP_CREDIT_ID = "house:overflow-skip-credit";

async function getHouseSkipCredit(): Promise<number> {
  if (!prisma) return 0;
  const row = await prisma.distributionCursor.findUnique({ where: { id: HOUSE_SKIP_CREDIT_ID } });
  const n = parseInt(row?.lastRecipientId ?? "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function setHouseSkipCredit(n: number): Promise<void> {
  if (!prisma) return;
  const v = String(Math.max(0, n));
  await prisma.distributionCursor.upsert({
    where: { id: HOUSE_SKIP_CREDIT_ID },
    update: { lastRecipientId: v },
    create: { id: HOUSE_SKIP_CREDIT_ID, lastRecipientId: v },
  });
}

/** Consume one skip credit if any are banked; returns true if the house's turn should be skipped. */
async function consumeHouseSkipCredit(): Promise<boolean> {
  const cur = await getHouseSkipCredit();
  if (cur <= 0) return false;
  await setHouseSkipCredit(cur - 1);
  return true;
}

// ─── TEMPORARY: ABCA event boost (Ryan, Nov 9–11 2026) ───────────────────────
// For an event, temporarily prioritize the house (Ryan) on ABCA original-campaign
// leads: 3 of every 4 go to Ryan, the 4th flows to the normal rotation (Luke +
// other outstanding orders). ABCA original campaign = the early-retirement-quiz
// funnel (americanbluecollaradvantage.com). HWA and the Enhanced Wealth / EWWS
// pages are NOT affected by this block.
//
// Auto-expires at the START of Nov 12 (America/Chicago = CST, UTC-6) → after that
// routeAbcaEventBoost is a no-op and ABCA returns to the usual per-state round
// robin, no action needed.
//
// EASILY REVERSIBLE — to end it early either (a) set ABCA_EVENT_BOOST.enabled =
// false and deploy, or (b) revert this commit. Deleting this const + the
// routeAbcaEventBoost function + its one call in tryFulfillForNewLead fully
// removes it. The counter lives in DistributionCursor id "abca:event-boost"; it's
// harmless to leave behind.
const ABCA_EVENT_BOOST = {
  enabled: true,
  endsAt: new Date("2026-11-12T06:00:00Z"), // Nov 12 00:00 America/Chicago (CST)
  oneInEveryToRotation: 4, // every 4th matching lead → normal rotation; the other 3 → house
  // Paused from the afternoon of Nov 10 and again for the rest of Nov 11 (owner
  // request): ABCA leads go through the normal rotation so the buyers with open
  // orders (Luke) take even turns with the house. The pause now runs to endsAt,
  // so the boost does not come back before it expires.
  pausedUntil: new Date("2026-11-12T06:00:00Z"),
};
const ABCA_EVENT_CURSOR_ID = "abca:event-boost";

/** An ABCA original-campaign lead = the early-retirement-quiz funnel. */
function isAbcaOriginalLead(source: string | null): boolean {
  return (source ?? "").toLowerCase().includes("early-retirement-quiz");
}

/**
 * Event boost: route 3 of every 4 ABCA original-campaign leads to the house.
 * Returns true if it claimed the lead (caller stops distributing); false means
 * this lead falls through to the normal rotation — either because the window is
 * closed, it isn't an ABCA lead, or it's the 1-in-4 that belongs to the buyers.
 * Uses the same persistent DistributionCursor counter pattern as the house skip
 * credit; low volume makes the read-modify-write race immaterial.
 */
async function routeAbcaEventBoost(lead: { id: string; source: string | null }): Promise<boolean> {
  if (!prisma || !ABCA_EVENT_BOOST.enabled) return false;
  if (Date.now() >= ABCA_EVENT_BOOST.endsAt.getTime()) return false; // window closed → normal
  if (Date.now() < ABCA_EVENT_BOOST.pausedUntil.getTime()) return false; // paused today → normal
  if (!isAbcaOriginalLead(lead.source)) return false;

  const row = await prisma.distributionCursor.findUnique({ where: { id: ABCA_EVENT_CURSOR_ID } });
  const prev = parseInt(row?.lastRecipientId ?? "0", 10);
  const n = (Number.isFinite(prev) ? prev : 0) + 1;
  await prisma.distributionCursor.upsert({
    where: { id: ABCA_EVENT_CURSOR_ID },
    update: { lastRecipientId: String(n) },
    create: { id: ABCA_EVENT_CURSOR_ID, lastRecipientId: String(n) },
  });
  // Every Nth lead flows to the normal rotation (buyers/Luke); the rest → house.
  if (n % ABCA_EVENT_BOOST.oneInEveryToRotation === 0) return false;

  const house = await getHouseAccount();
  if (!house) return false;
  const res = await prisma.lead.updateMany({
    where: { id: lead.id, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: house.userId,
      assignedAt: new Date(),
      ...(house.organizationId ? { organizationId: house.organizationId } : {}),
    },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: {
      leadId: lead.id,
      type: "LEAD_ASSIGNED",
      body: "Routed to house CRM — temporary ABCA event boost (3 of every 4 → Ryan, through Nov 11).",
    },
  });
  return true;
}
// ─── end TEMPORARY ABCA event boost ──────────────────────────────────────────

/**
 * Route a brand-new lead, then, if it landed in a team's Goldmine, email that
 * team's agents so someone calls fast (lib/goldmineAlert.ts).
 */
export async function tryFulfillForNewLead(leadId: string): Promise<void> {
  if (!prisma) return;
  const before = await prisma.lead.findUnique({ where: { id: leadId }, select: { assignedUserId: true } });
  if (!before || before.assignedUserId) return; // already routed
  await routeNewLead(leadId);
  await alertGoldmineTeamOfNewLead(leadId);
}

async function routeNewLead(leadId: string): Promise<void> {
  if (!prisma) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead || lead.assignedUserId) return;

  // Testing hold-back: a lead tagged as a product under evaluation goes straight
  // to the house (Ryan) before any buyer distribution runs.
  if (await routeHeldBackTagToHouse(lead)) return;

  // Owner-only pages: Enhanced Wealth + Essential Workers (EWWS) instant-form
  // leads go 100% to the house (Ryan) — never to a buyer, overflow admin, or
  // team. Runs before all buyer distribution; the quiz funnels fall through.
  // TEMP_ROTATION_GUEST (Nov 2026): text-verified Enhanced Wealth Blue Collar
  // leads take turns between Ryan and the guests (Kyle) while the toggle
  // in lib/tempRotationGuest.ts is on.
  // SHARED_POOL (Nov 2026): Enhanced Wealth Blue Collar and ABCA quiz leads go
  // through the round-robin below, advertiser clients included (lib/sharedPool.ts).
  // Essential Workers leads (Nov 16 2026), Blue Collar ("ewws") and Nurse, go
  // ONLY to advertisers who have that lead type on (lib/leadTypes.ts).
  const pool = SHARED_POOL.enabled ? sharedPoolOf(lead) : null;
  const toggleOnly = !!pool && TOGGLE_ONLY_POOLS.has(pool);
  if (pool === null || pool === "abca") {
    if (await routeEwTextVerifiedToGuest(lead)) return;
    if (await routePageLeadToHouse(lead)) return;
  }

  // Replacements get FIRST claim (owner directive, Oct 2026): a lead owed to a
  // paying client as an approved replacement outranks filling outstanding orders
  // — we make good on bad leads before fulfilling new volume. Only admin-greenlit
  // requests auto-fill, and fulfillReplacement still enforces the request's order
  // states + age, so this can't deliver an off-state/off-order lead.
  if (!toggleOnly && (await tryReplacementForFreshLead(leadId))) return;

  // TEMPORARY event boost (Nov 9–11 2026): 3 of every 4 ABCA original-campaign
  // leads go to the house (Ryan); the 4th flows to the normal rotation below.
  // Owed replacements above still take precedence. Auto-expires Nov 12 — see
  // ABCA_EVENT_BOOST. Easily reversible (flip its `enabled` or revert the commit).
  if (await routeAbcaEventBoost(lead)) return;

  const pendingOrders = await prisma.order.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING", "DELIVERING"] },
      // Match direct-pool orders and any aged-bucket order drawing from this pool.
      packageId: { in: purchasableIdsForPool(lead.packageId) },
      OR: [
        { filterStates: { isEmpty: true } },
        { filterStates: { has: lead.state } },
      ],
    },
    orderBy: { createdAt: "asc" },
    include: { leads: { where: { trashedAt: null }, select: { id: true } } },
  });

  const adminSlots = await getEligibleAdminSlots();

  // Orders that can take THIS lead: cover its state, in the age window, not full.
  // CLIENT_PAUSES (lib/clientPause.ts): a client on a dated pause has no turn,
  // so the lead goes to the next client instead of waiting on their order.
  const eligibleOrders = pendingOrders.filter(
    (o) =>
      o.filterStates.length > 0 &&
      o.leads.length < o.quantity &&
      leadAgeEligibleForOrder(o, lead.receivedAt) &&
      !isClientPaused(o.deliverToUserId ?? o.userId),
  );

  // LICENSING GUARD: never deliver a lead in a state the recipient isn't licensed
  // in. We check the recipient's licensedStates; if they haven't set any yet, fall
  // back to the order's states (can't enforce licensing we don't have on file).
  const recipientIds = [...new Set(eligibleOrders.map((o) => o.deliverToUserId ?? o.userId))];
  const licRows = recipientIds.length
    ? await prisma.user.findMany({ where: { id: { in: recipientIds } }, select: { id: true, licensedStates: true } })
    : [];
  const licensedById = new Map(licRows.map((u) => [u.id, u.licensedStates ?? []]));
  const licensedOrders = eligibleOrders.filter((o) => {
    const rid = o.deliverToUserId ?? o.userId;
    const ls = licensedById.get(rid) ?? [];
    return ls.length === 0 || ls.includes(lead.state);
  });

  // ── Per-state round-robin intake (owner directive) ──────────────────────
  // Rotate each fresh lead across every DISTINCT buyer with an eligible open
  // order (a buyer with two orders is still one slot), PLUS every admin still
  // under their rolling-7-day overflow target (each an "overflow slot"). Per
  // state, so each state alternates independently (an exact 1/N share). Overflow
  // is NO LONGER auto-routed to Ryan — admins opt in via their weekly target,
  // and anything no buyer/admin takes stays in the BANK as sellable stock.
  const orderForRecipient = new Map<string, string>(); // recipientId -> oldest eligible orderId
  const buyerIds: string[] = [];
  for (const o of licensedOrders) {
    const rid = o.deliverToUserId ?? o.userId;
    if (!orderForRecipient.has(rid)) {
      orderForRecipient.set(rid, o.id);
      buyerIds.push(rid);
    }
  }
  // LICENSING GUARD for admin overflow: only admins licensed in THIS lead's
  // state may take it as overflow (empty licensedStates = licensed everywhere,
  // the same fallback buyers get). Without this, an admin's weekly overflow
  // pulled leads in states they aren't licensed in.
  // PREPAY (lib/leadCostLedger.ts): when the admins have chosen to pay for
  // their leads first, they only take a turn while their balance covers this
  // lead's cost. On "advance" (leads first, pay after) this is always true.
  const licensedAdminSlots = adminSlots.filter(
    (s) => s.licensedStates.length === 0 || s.licensedStates.includes(lead.state),
  );
  const eligibleAdminSlots = licensedAdminSlots.length > 0 && (await adminLeadFunded(pool)) ? licensedAdminSlots : [];
  const adminById = new Map(eligibleAdminSlots.map((s) => [s.userId, s]));
  // An admin who is also a buyer stays a buyer slot (don't double-count).
  const adminIds = eligibleAdminSlots.map((s) => s.userId).filter((id) => !orderForRecipient.has(id));
  // Toggle-only pools skip buyers' orders: just the advertisers with the type
  // on, and an admin who has it on takes a turn like they do (owner, Nov 18
  // 2026: "Ryan should be in a normal round robin like everybody else").
  const rotation = toggleOnly
    ? adminIds.filter((id) => leadTypeOn(adminById.get(id)?.leadTypes, poolLeadType(pool!)))
    : [...buyerIds, ...adminIds];

  // TEMP_ROTATION_GUEST (Nov 2026): each guest (Kyle) is one more slot
  // in the ABCA landing-page round-robin while the toggle in
  // lib/tempRotationGuest.ts is on.
  // HOUSE_PAUSE: while Ryan is away the guests also take turns on the Blue
  // Collar page leads (Enhanced Wealth, text-verified, EWWS) that now come here.
  // Not on toggle-only pools: those only go to advertisers with the type on.
  const guestTakesTurn =
    !toggleOnly &&
    (isAbcaLandingPageLead(lead.source) || pool !== null || (isHousePaused() && lead.packageId === "blue-collar-iul"));
  const guests = TEMP_ROTATION_GUEST.enabled && guestTakesTurn ? await getRotationGuests() : [];
  const guestById = new Map<string, (typeof guests)[number]>();
  for (const g of guests) {
    // Licensed in this state, and not already in the rotation as a buyer.
    if (!guestLicensedFor(g.licensedStates, lead.state) || rotation.includes(g.userId)) continue;
    guestById.set(g.userId, g);
    rotation.push(g.userId);
  }

  // SHARED_POOL: every advertiser client with ad budget left for one lead is a
  // slot too; their turn is charged at the source campaign's cost per lead.
  const clientById = new Map<string, ClientSlot>();
  if (pool) {
    for (const c of await sharedClientSlots(lead.state, pool)) {
      if (rotation.includes(c.userId)) continue; // already a buyer / admin / guest slot
      clientById.set(c.userId, c);
      rotation.push(c.userId);
    }
  }

  // CLIENT_PAUSES: nobody on a dated pause takes a turn, whichever kind of slot they hold.
  for (let i = rotation.length - 1; i >= 0; i--) if (isClientPaused(rotation[i])) rotation.splice(i, 1);

  if (rotation.length > 0) {
    // Toggle-only pools keep their own turn order, so the main rotation's turns don't skew theirs.
    const cursorKey = toggleOnly ? `${pool}:st:${lead.state}` : `st:${lead.state}`;
    const cursor = await prisma.distributionCursor.findUnique({ where: { id: cursorKey } });
    const lastIdx = cursor?.lastRecipientId ? rotation.indexOf(cursor.lastRecipientId) : -1;
    const setCursor = (rid: string) =>
      prisma!.distributionCursor.upsert({
        where: { id: cursorKey },
        update: { lastRecipientId: rid },
        create: { id: cursorKey, lastRecipientId: rid },
      });

    // The turn order starts at the slot AFTER whoever got the last lead.
    const turnOrder = rotation.map((_, step) => rotation[(lastIdx + 1 + step) % rotation.length]);
    // FEWEST FIRST (lib/fewestFirst.ts): offer the lead to whoever has had the
    // fewest leads in the last 24 hours, the turn order breaking ties, so a
    // person in a few quiet states isn't starved by people in many busy ones.
    const offerOrder = FEWEST_FIRST.enabled
      ? fewestFirstOrder(turnOrder, await leadsReceivedRecently(turnOrder))
      : turnOrder;

    // Take the first that accepts.
    for (const rid of offerOrder) {
      const guestSlot = guestById.get(rid);
      if (guestSlot) {
        const what = isAbcaLandingPageLead(lead.source) ? "ABCA landing-page round-robin" : "Blue Collar round-robin";
        if (await assignLeadToGuest(leadId, guestSlot, what)) {
          await setCursor(rid);
          return;
        }
        continue;
      }
      const clientSlot = clientById.get(rid);
      if (clientSlot && pool) {
        if (await deliverSharedLeadToClient(leadId, clientSlot, pool)) {
          await setCursor(rid);
          return;
        }
        continue;
      }
      const adminSlot = adminById.get(rid);
      if (adminSlot) {
        // An admin's overflow turn (fresh-only). Replacements already had first
        // claim at the top of this function.
        if (await assignOverflowLeadTo(leadId, adminSlot.userId, adminSlot.organizationId, "round-robin overflow")) {
          await setCursor(rid);
          return;
        }
        continue; // admin declined (e.g. lead not fresh) — try the next slot
      }
      const assigned = await fulfillOrder(orderForRecipient.get(rid)!, { onlyLeadId: leadId });
      if (assigned > 0) { await setCursor(rid); return; }
      // That buyer's order filled concurrently — advance to the next slot.
    }
  }

  // SHARED_POOL: an Enhanced Wealth lead nobody could take goes to the house as
  // before (routePageLeadToHouse does nothing while HOUSE_PAUSE holds it).
  if ((pool === "ew" || toggleOnly) && (await routePageLeadToHouse(lead))) return;

  // Not claimed by any buyer order, and no admin under their weekly target took
  // it → leave it in the BANK (unassigned) as sellable stock for its state.
  // Overflow is no longer auto-routed to an admin (owner directive, Oct 2026).
}
