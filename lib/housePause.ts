import { prisma } from "./prisma";

// ─── TEMPORARY: no new leads to the house (owner request, Nov 13 2026) ────────
// Ryan is travelling, so while this is on NOTHING new is routed to his CRM:
//  - Enhanced Wealth + Essential Workers (EWWS) page leads stop being house-only
//    and go through the normal per-state rotation instead: clients with an open
//    order, plus the temporary rotation guest (lib/tempRotationGuest.ts). That
//    includes the text-verified Enhanced Wealth Blue Collar form, which stops
//    alternating Ryan / guest and joins the same rotation.
//  - Leads from forms Ryan owns as an advertiser (the EWWS forms) take the same
//    route instead of being delivered to him.
//  - Ryan's overflow slot in the rotation is skipped.
//  - Replacements owed to Ryan wait: they do not claim fresh leads on intake.
// A lead no client can take (no open order or guest covers its state, or it is
// not a Blue Collar lead) stays unassigned in the bank; it is not sent to Ryan.
//
// TO TURN IT BACK ON: set `enabled: false` below and deploy. Routing returns to
// exactly what it was; leads delivered to clients in the meantime stay with them,
// and leads left in the bank stay there (they are not swept to Ryan afterwards).
export const HOUSE_PAUSE = {
  enabled: true,
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
