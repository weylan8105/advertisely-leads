import { prisma } from "./prisma";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { forwardLeadToRingy, isRingyConfigured, type RingyConfig } from "./ringy";
import { leadFormId } from "./textVerified";
import { findPackage } from "@/data/packages";
import { isHousePaused } from "./housePause";
import { getAdSpendSummary, forgetAdSpendSummary, SHARED_LEAD_METHOD } from "./adSpend";
import { sharedPoolOf, sharedCplCents, needsFreeLeads, clientLeadPriceCents, FREE_UNTIL_CPL } from "./sharedPool";
import { ADVERTISER_NAME_KEY } from "./leadOrigin";
import { goldmineLeadData } from "./leadDestination";

// ─── TEMPORARY: guest agents in the lead rotation (owner request, Nov 2026) ───
// Kyle Vietzke (David Layton's team, since Nov 11) gets leads while their own campaigns ramp up. Until the owner says to
// stop, each of them takes turns on (since Nov 19 Kyle's turns land in David's
// team Goldmine, see `toPayerGoldmine` below):
//  - Text-verified Enhanced Wealth Blue Collar leads (the OTP form below):
//    these normally go 100% to the house (Ryan); now Ryan and the guests take
//    even turns (Kyle, Ryan, Kyle, …).
//  - ABCA landing-page leads (the early-retirement-quiz funnel): each guest is
//    one more slot in the per-state round-robin, next to the open buyer orders
//    and admin overflow slots.
// While HOUSE_PAUSE (lib/housePause.ts) is on there are no Ryan turns: every
// Blue Collar lead goes to the per-state round-robin and the guests are slots.
//
// TO TURN IT OFF: set `enabled: false` below and deploy (or remove one guest
// from the list to stop just theirs). Nothing else changes — leads already
// delivered stay where they are, and routing goes straight back to normal. To
// remove it entirely, delete this file and its two call sites in
// lib/fulfillment.ts (search "TEMP_ROTATION_GUEST"). The turn counter in
// DistributionCursor id "temp-guest:ew-otp" is harmless to leave behind.
export const TEMP_ROTATION_GUEST = {
  enabled: true,
  guests: [
    {
      email: "kylevitz@gmail.com",
      name: "Kyle",
      reason: "temporary rotation for Kyle while his new creatives ramp up",
      // Owner request (Nov 13 2026): every lead Kyle takes here counts as
      // David's (David's name on the card, on David's dashboard). It's free
      // while David's cost per lead is above FREE_UNTIL_CPL (lib/sharedPool.ts);
      // at or below it, it's charged to David's ad-spend balance at the source
      // campaign's cost per lead, and skipped if David can't cover it.
      billTo: { email: "dclayton1235@gmail.com" },
      // Owner request (Nov 19 2026): Kyle's turns land in David's team Goldmine
      // (owned by David, New Lead stage) instead of Kyle's own pipeline, where
      // the whole team works them. No lead email and no Ringy forward, like
      // every Goldmine lead. Kyle's existing leads were moved there Nov 18.
      toPayerGoldmine: true,
    },
    // Angelo was a free guest Nov 13; removed the same day (owner: his leads come
    // out of his ad spend). He still gets leads as an advertiser client in the
    // shared pool (lib/sharedPool.ts), charged per lead.
  ],
};

// Enhanced Wealth page forms with the one-time-passcode (text) check. EWWS's
// text-verified forms are deliberately NOT here — this is Enhanced Wealth only.
export const EW_TEXT_VERIFIED_FORM_IDS = new Set<string>([
  "1491493996376938", // EW - Blue Collar Lead Form 11/11 - LP Questions + SMS Verified
]);

const EW_CURSOR_ID = "temp-guest:ew-otp";

/** A text-verified Enhanced Wealth Blue Collar lead (the OTP form). */
export function isEwTextVerifiedLead(lead: { rawFormData?: unknown }): boolean {
  return EW_TEXT_VERIFIED_FORM_IDS.has(leadFormId(lead.rawFormData));
}

/** An ABCA landing-page lead = the early-retirement-quiz funnel. */
export function isAbcaLandingPageLead(source: string | null): boolean {
  return (source ?? "").toLowerCase().includes("early-retirement-quiz");
}

/** Licensed in the state? No states on file = licensed everywhere (same rule buyers get). */
export function guestLicensedFor(licensedStates: string[], state: string | null): boolean {
  return licensedStates.length === 0 || (!!state && licensedStates.includes(state));
}

/**
 * Whose turn the nth text-verified lead is, with `guests` guests taking even
 * turns with Ryan: the guest's index (0-based), or -1 for Ryan's turn. One
 * guest gives guest, Ryan, guest, Ryan …; two give guest A, guest B, Ryan, ….
 */
export function guestTurnIndex(n: number, guests: number): number {
  if (guests <= 0) return -1;
  return (n % (guests + 1)) - 1;
}

export type GuestBillTo = { email: string };

/**
 * Where a guest's lead lands. With `toPayerGoldmine`, in the Goldmine of the
 * team the guest is on, when the payer owns that team and its Goldmine is on;
 * otherwise in the guest's own pipeline. Pure.
 */
export function guestGoldmineOrgId(
  guest: { toPayerGoldmine?: boolean; organizationId: string | null },
  payerId: string | null,
  org: { id: string; ownerId: string; goldmineEnabled: boolean } | null,
): string | null {
  if (!guest.toPayerGoldmine || !payerId || !org) return null;
  if (org.id !== guest.organizationId || org.ownerId !== payerId || !org.goldmineEnabled) return null;
  return org.id;
}

export type RotationGuest = {
  userId: string;
  organizationId: string | null;
  licensedStates: string[];
  name: string;
  reason: string;
  billTo?: GuestBillTo;
  toPayerGoldmine?: boolean;
};


/** The guest agents while the toggle is on (in list order), else none. */
export async function getRotationGuests(): Promise<RotationGuest[]> {
  if (!prisma || !TEMP_ROTATION_GUEST.enabled) return [];
  const out: RotationGuest[] = [];
  for (const g of TEMP_ROTATION_GUEST.guests) {
    const u = await prisma.user.findFirst({
      where: { email: { equals: g.email, mode: "insensitive" } },
      select: {
        id: true,
        licensedStates: true,
        defaultOrganizationId: true,
        memberships: { select: { organizationId: true }, orderBy: { createdAt: "asc" }, take: 1 },
      },
    });
    if (!u) continue;
    out.push({
      userId: u.id,
      organizationId: u.memberships[0]?.organizationId ?? u.defaultOrganizationId ?? null,
      licensedStates: u.licensedStates ?? [],
      name: g.name,
      reason: g.reason,
      ...("billTo" in g && g.billTo ? { billTo: g.billTo } : {}),
      ...("toPayerGoldmine" in g && g.toPayerGoldmine ? { toPayerGoldmine: true } : {}),
    });
  }
  return out;
}

/**
 * Enhanced Wealth text-verified lead: Ryan and the guests take even turns.
 * Returns true if a guest took it; false leaves it to the normal house routing (Ryan).
 */
export async function routeEwTextVerifiedToGuest(lead: {
  id: string;
  state: string | null;
  rawFormData: unknown;
}): Promise<boolean> {
  if (!prisma || !TEMP_ROTATION_GUEST.enabled || !isEwTextVerifiedLead(lead)) return false;
  // HOUSE_PAUSE: with Ryan away there is no Ryan / guest alternation. The lead
  // goes to the per-state rotation instead, where the guest is one of the slots.
  if (isHousePaused()) return false;
  // Only guests licensed in the lead's state take turns on it.
  const guests = (await getRotationGuests()).filter((g) => guestLicensedFor(g.licensedStates, lead.state));
  if (guests.length === 0) return false;

  const row = await prisma.distributionCursor.findUnique({ where: { id: EW_CURSOR_ID } });
  const prev = parseInt(row?.lastRecipientId ?? "0", 10);
  const n = (Number.isFinite(prev) ? prev : 0) + 1;
  await prisma.distributionCursor.upsert({
    where: { id: EW_CURSOR_ID },
    update: { lastRecipientId: String(n) },
    create: { id: EW_CURSOR_ID, lastRecipientId: String(n) },
  });
  const turn = guestTurnIndex(n, guests.length);
  if (turn < 0) return false; // Ryan's turn
  return assignLeadToGuest(lead.id, guests[turn], "text-verified Enhanced Wealth Blue Collar lead");
}

/**
 * Hand one lead to the guest: assign, log, email, and forward to their Ringy if
 * they've linked one. Guarded on assignedUserId:null so it never double-assigns.
 */
export async function assignLeadToGuest(leadId: string, guest: RotationGuest, what: string): Promise<boolean> {
  if (!prisma) return false;

  // A billed guest's lead counts as the payer's: free while the payer's cost
  // per lead is above the target, charged to them once it's at or below it.
  let bill: { payerId: string; payerName: string; cplCents: number; free: boolean } | null = null;
  if (guest.billTo) {
    const payer = await prisma.user.findFirst({
      where: { email: { equals: guest.billTo.email, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    });
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { source: true, rawFormData: true, campaignName: true, packageId: true },
    });
    if (!payer || !lead) return false;
    const s = await getAdSpendSummary(payer.id).catch(() => null);
    // Never decide on a balance we couldn't read.
    if (!s || s.errors.length) return false;
    // The payer is a November fee client past their renewal date who hasn't joined the Advertiser Program.
    if (s.program.mustJoin) return false;
    const payerName = payer.name?.trim() || payer.email;
    if (needsFreeLeads(s)) {
      bill = { payerId: payer.id, payerName, cplCents: 0, free: true };
    } else {
      const cplCents = clientLeadPriceCents(await sharedCplCents(sharedPoolOf(lead) ?? "ew"), s);
      if (s.balanceCents < cplCents) return false; // can't cover it: skip this slot
      bill = { payerId: payer.id, payerName, cplCents, free: false };
    }
  }

  // A guest whose leads go to the payer's team Goldmine: the payer owns the
  // lead and it sits in the shared Goldmine for the team to work.
  const goldmineOrg =
    bill && guest.toPayerGoldmine && guest.organizationId
      ? await prisma.organization.findUnique({
          where: { id: guest.organizationId },
          select: { id: true, ownerId: true, goldmineEnabled: true },
        })
      : null;
  const goldmineOrgId = guestGoldmineOrgId(guest, bill?.payerId ?? null, goldmineOrg);
  const now = new Date();

  const current = bill
    ? await prisma.lead.findUnique({ where: { id: leadId }, select: { rawFormData: true } })
    : null;
  const raw = current?.rawFormData && typeof current.rawFormData === "object" && !Array.isArray(current.rawFormData)
    ? (current.rawFormData as Record<string, unknown>)
    : {};
  const res = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: goldmineOrgId && bill ? bill.payerId : guest.userId,
      assignedAt: now,
      ...(guest.organizationId ? { organizationId: guest.organizationId } : {}),
      ...(goldmineOrgId ? goldmineLeadData(goldmineOrgId, now) : {}),
      // A billed lead carries the payer's name, like their own campaign's leads.
      ...(bill ? { rawFormData: { ...raw, [ADVERTISER_NAME_KEY]: bill.payerName } as any } : {}),
    },
  });
  if (res.count === 0) return false;
  const cost = bill ? (bill.cplCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" }) : "";
  const to = goldmineOrgId && bill ? `${bill.payerName}'s team Goldmine (${guest.name}'s turn)` : guest.name;
  await prisma.leadActivity.create({
    data: {
      leadId,
      type: "LEAD_ASSIGNED",
      body: bill
        ? bill.free
          ? `Routed to ${to} — ${what}; free lead for ${bill.payerName} (no charge) while their cost per lead is above $${FREE_UNTIL_CPL.targetCents / 100}.`
          : `Routed to ${to} — ${what}; ${cost} cost per lead taken from ${bill.payerName}'s ad-spend balance.`
        : `Routed to ${guest.name} — ${what} (${guest.reason}).`,
    },
  });
  if (bill?.free) forgetAdSpendSummary(bill.payerId);
  if (bill && !bill.free) {
    await prisma.adSpendPayment.create({
      data: { userId: bill.payerId, amountCents: -bill.cplCents, method: SHARED_LEAD_METHOD, note: `${guest.name}'s guest lead ${leadId}` },
    });
    forgetAdSpendSummary(bill.payerId);
  }

  // Goldmine leads get no lead email and no Ringy forward (lib/leadDestination.ts).
  if (goldmineOrgId) return true;

  const full = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      name: true, phone: true, email: true, state: true, age: true, occupation: true,
      income: true, intentReason: true, packageId: true, rawFormData: true,
    },
  });
  if (!full) return true;

  try {
    const ringy = await prisma.integration.findUnique({
      where: { userId_type: { userId: guest.userId, type: "RINGY" } },
      select: { enabled: true, config: true, id: true },
    });
    const cfg = ringy?.config as Partial<RingyConfig> | undefined;
    if (ringy?.enabled && isRingyConfigured(cfg)) {
      const result = await forwardLeadToRingy(full, cfg);
      await prisma.leadActivity.create({
        data: {
          leadId,
          type: "LEAD_RECEIVED",
          body: result.ok ? `Forwarded to ${guest.name}'s Ringy CRM.` : `Ringy forward failed — ${result.error ?? "unknown error"}.`,
        },
      });
      await prisma.integration.update({ where: { id: ringy.id }, data: { lastUsedAt: new Date() } });
    }
  } catch (e) {
    console.warn("[temp guest] Ringy forward failed:", e);
  }

  if (isEmailConfigured) {
    try {
      const recipient = await prisma.user.findUnique({ where: { id: guest.userId }, select: { email: true, name: true } });
      if (recipient?.email) {
        await sendLeadDeliveryEmail({
          agentEmail: recipient.email,
          agentName: recipient.name ?? "there",
          leadCount: 1,
          packageName: findPackage(full.packageId)?.name ?? "IUL",
          orderId: leadId,
          leads: [{
            name: full.name, phone: full.phone, email: full.email, state: full.state,
            occupation: full.occupation, age: full.age, income: full.income, intentReason: full.intentReason,
          }],
        });
      }
    } catch (e) {
      console.warn("[temp guest] lead email failed:", e);
    }
  }
  return true;
}
// ─── end TEMPORARY guest rotation ─────────────────────────────────────────────
