import { prisma } from "./prisma";

// ─── House pause: OFF since Nov 18 2026 (owner: "turn Ryan back on") ──────────
// It was on Nov 13 to Nov 18 2026 while Ryan was travelling. While it is on,
// NOTHING new is routed to his CRM:
//  - Enhanced Wealth + Essential Workers (EWWS) page leads that would fall back
//    to the house stay unassigned in the bank instead.
//  - Leads from forms Ryan owns as an advertiser go through the rotation instead
//    of being delivered to him.
//  - Ryan's overflow slot in the rotation is skipped.
//  - Replacements owed to Ryan wait: they do not claim fresh leads on intake.
//  - The rotation guests (lib/tempRotationGuest.ts) take turns on every Blue
//    Collar page lead, not only the ABCA and shared-pool ones.
//
// With it off, Ryan gets: his overflow slot in the per-state rotation (states on
// his licence, up to his weekly target), any Enhanced Wealth / Essential Workers
// lead no client can take, and the replacements owed to him. Leads delivered to
// clients during the pause stay with them, and leads left in the bank stay there.
//
// TO PAUSE AGAIN: set `enabled: true` below and deploy.
export const HOUSE_PAUSE = {
  enabled: false,
  reason: "Ryan is travelling",
};

// Ryan's account is the house (see lib/house.ts getHouseAccount).
export const HOUSE_EMAIL = (process.env.HOUSE_ACCOUNT_EMAIL || "ryanrush129@gmail.com").trim().toLowerCase();

export function isHousePaused(): boolean {
  return HOUSE_PAUSE.enabled;
}

/** Is this user the house account, while house routing is paused? */
export async function isPausedHouseUser(userId: string | null | undefined): Promise<boolean> {
  if (!HOUSE_PAUSE.enabled || !userId || !prisma) return false;
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return (u?.email ?? "").trim().toLowerCase() === HOUSE_EMAIL;
  } catch {
    return false;
  }
}

/** Is this user the house account (paused or not)? */
export async function isHouseUser(userId: string | null | undefined): Promise<boolean> {
  if (!userId || !prisma) return false;
  try {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return (u?.email ?? "").trim().toLowerCase() === HOUSE_EMAIL;
  } catch {
    return false;
  }
}
