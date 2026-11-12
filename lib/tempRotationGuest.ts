import { prisma } from "./prisma";
import { sendLeadDeliveryEmail, isEmailConfigured } from "./email";
import { forwardLeadToRingy, isRingyConfigured, type RingyConfig } from "./ringy";
import { leadFormId } from "./textVerified";
import { findPackage } from "@/data/packages";

// ─── TEMPORARY: guest agent in the lead rotation (owner request, Nov 11 2026) ──
// Kyle Vietzke (David Layton's team) gets leads while his new ad creatives pick
// up traction. Until the owner says to stop, he takes turns on:
//  - Text-verified Enhanced Wealth Blue Collar leads (the OTP form below):
//    these normally go 100% to the house (Ryan); now Ryan and Kyle alternate.
//  - ABCA landing-page leads (the early-retirement-quiz funnel): Kyle is one
//    more slot in the per-state round-robin, next to the open buyer orders and
//    admin overflow slots.
//
// TO TURN IT OFF: set `enabled: false` below and deploy. Nothing else changes —
// leads already delivered to Kyle stay with him, and routing goes straight back
// to normal. To remove it entirely, delete this file and its two call sites in
// lib/fulfillment.ts (search "TEMP_ROTATION_GUEST"). The alternation counter in
// DistributionCursor id "temp-guest:ew-otp" is harmless to leave behind.
export const TEMP_ROTATION_GUEST = {
  enabled: true,
  email: "kylevitz@gmail.com",
  reason: "temporary rotation for Kyle while his new creatives ramp up",
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

/** The guest's turn on the Ryan/guest alternation: every other lead (1st, 3rd, 5th …). */
export function isGuestTurn(n: number): boolean {
  return n % 2 === 1;
}

export type RotationGuest = { userId: string; organizationId: string | null; licensedStates: string[] };

/** The guest agent while the toggle is on, else null. */
export async function getRotationGuest(): Promise<RotationGuest | null> {
  if (!prisma || !TEMP_ROTATION_GUEST.enabled) return null;
  const u = await prisma.user.findFirst({
    where: { email: { equals: TEMP_ROTATION_GUEST.email, mode: "insensitive" } },
    select: {
      id: true,
      licensedStates: true,
      defaultOrganizationId: true,
      memberships: { select: { organizationId: true }, orderBy: { createdAt: "asc" }, take: 1 },
    },
  });
  if (!u) return null;
  return {
    userId: u.id,
    organizationId: u.memberships[0]?.organizationId ?? u.defaultOrganizationId ?? null,
    licensedStates: u.licensedStates ?? [],
  };
}

/**
 * Enhanced Wealth text-verified lead: alternate Ryan / guest. Returns true if the
 * guest took it; false leaves it to the normal house routing (Ryan).
 */
export async function routeEwTextVerifiedToGuest(lead: {
  id: string;
  state: string | null;
  rawFormData: unknown;
}): Promise<boolean> {
  if (!prisma || !TEMP_ROTATION_GUEST.enabled || !isEwTextVerifiedLead(lead)) return false;
  const guest = await getRotationGuest();
  if (!guest || !guestLicensedFor(guest.licensedStates, lead.state)) return false;

  const row = await prisma.distributionCursor.findUnique({ where: { id: EW_CURSOR_ID } });
  const prev = parseInt(row?.lastRecipientId ?? "0", 10);
  const n = (Number.isFinite(prev) ? prev : 0) + 1;
  await prisma.distributionCursor.upsert({
    where: { id: EW_CURSOR_ID },
    update: { lastRecipientId: String(n) },
    create: { id: EW_CURSOR_ID, lastRecipientId: String(n) },
  });
  if (!isGuestTurn(n)) return false;
  return assignLeadToGuest(lead.id, guest, "text-verified Enhanced Wealth Blue Collar lead");
}

/**
 * Hand one lead to the guest: assign, log, email, and forward to their Ringy if
 * they've linked one. Guarded on assignedUserId:null so it never double-assigns.
 */
export async function assignLeadToGuest(leadId: string, guest: RotationGuest, what: string): Promise<boolean> {
  if (!prisma) return false;
  const res = await prisma.lead.updateMany({
    where: { id: leadId, assignedUserId: null, trashedAt: null },
    data: {
      assignedUserId: guest.userId,
      assignedAt: new Date(),
      ...(guest.organizationId ? { organizationId: guest.organizationId } : {}),
    },
  });
  if (res.count === 0) return false;
  await prisma.leadActivity.create({
    data: { leadId, type: "LEAD_ASSIGNED", body: `Routed to Kyle — ${what} (${TEMP_ROTATION_GUEST.reason}).` },
  });

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
          body: result.ok ? "Forwarded to Kyle's Ringy CRM." : `Ringy forward failed — ${result.error ?? "unknown error"}.`,
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
