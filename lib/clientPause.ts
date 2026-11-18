// ─── Dated lead pauses for a client (owner request) ──────────────────────────
// While a client is inside one of these windows NO new leads are delivered to
// them:
//  - their open orders stop filling (lib/fulfillment.ts fulfillOrder), so a
//    weekly subscription order created during the pause just waits;
//  - they take no turn in the per-state round-robin on fresh intake, so their
//    turns go to the other clients instead of being held for them;
//  - replacements owed to them wait (lib/replacement.ts).
// Nothing is cancelled or refunded and billing is untouched: what they are owed
// stays on their open orders and starts filling again, from the leads that
// arrive after the window ends. Leads already in their pipeline are not touched.
//
// Times are exact instants. Central time is UTC-6 from Nov 1 2026 (standard
// time), so midnight Central = 06:00Z.
//
// TO END A PAUSE EARLY, OR ADD ONE: edit the list below and deploy. A window
// that has passed does nothing and can be deleted.
export const CLIENT_PAUSES: { userId: string; name: string; from: string; until: string; why: string }[] = [
  {
    // Owner, Nov 17 2026: "pause luke sheffers leads from the 20th to the 27th".
    // Paused from the start of Nov 20 through the end of Nov 27 (Central);
    // leads resume at 12:00 AM Central on Nov 28.
    userId: "cmu1muk4m0000jp043c27hqht",
    name: "Luke Scheffers",
    from: "2026-11-20T06:00:00.000Z",
    until: "2026-11-28T06:00:00.000Z",
    why: "owner request: no leads Nov 20–27",
  },
];

/** Is this client inside one of their pause windows right now (or at `at`)? */
export function isClientPaused(userId: string | null | undefined, at: Date = new Date()): boolean {
  if (!userId) return false;
  const t = at.getTime();
  return CLIENT_PAUSES.some(
    (p) => p.userId === userId && t >= new Date(p.from).getTime() && t < new Date(p.until).getTime(),
  );
}
