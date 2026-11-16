// ─── Advertisely Advertiser Program (owner directive, Nov 15 2026) ──────────
// Anyone can become an advertiser from the marketplace: $500 every 2 weeks, of
// which 20% is our management fee and the other $400 goes to their ad-spend
// balance. That balance buys leads at cost from the shared pool
// (lib/sharedPool.ts): each lead is the source campaign's cost per lead plus the
// 3% card fee (owner: the card fee goes on their cost per lead, not on us).
// Cancel anytime; whatever balance is left keeps buying leads until it runs out.
//
// Billing is a Stripe subscription (metadata.kind = ADVERTISER_PROGRAM_KIND).
// Each paid invoice becomes an AdSpendPayment row (method "program") worth the
// payment minus the fee (lib/advertiserProgramBilling.ts). Stripe is the record
// of who is a member; nothing about membership is stored in our database.
//
// Clients who paid the $3,000 monthly Advertisely Advertiser fee for November
// keep their setup until their renewal date. From then on they get leads only
// as Program members (owner: "leads stop until they join").

export const ADVERTISER_PROGRAM_KIND = "advertiser-program";

export const ADVERTISER_PROGRAM = {
  name: "Advertisely Advertiser Program",
  amountCents: 50_000,
  intervalWeeks: 2,
  feeRate: 0.2,
  cardFeeRate: 0.03,
};

// Renewal date of each client's November $3,000 fee (email → YYYY-MM-DD, Central).
export const LEGACY_RETAINER_UNTIL: Record<string, string> = {
  "angeloo.rodriguez05@gmail.com": "2026-12-01", // $500 + $2,500 (Nov 1)
  "jljensen38@gmail.com": "2026-12-02", // $3,000 (Nov 2)
  "dclayton1235@gmail.com": "2026-12-03", // $3,000 (Nov 3)
};

/** The management fee taken from one payment. */
export const programFeeCents = (paidCents: number) => Math.round(paidCents * ADVERTISER_PROGRAM.feeRate);

/** What one payment adds to the member's balance. */
export const programCreditCents = (paidCents: number) => Math.max(0, paidCents - programFeeCents(paidCents));

/** A member's price for a lead: the campaign's cost per lead plus the card fee. */
export const programLeadPriceCents = (cplCents: number) => Math.round(cplCents * (1 + ADVERTISER_PROGRAM.cardFeeRate));

/** A Stripe subscription as the program checks it (ClientSubscription in lib/adSpend.ts fits). */
export interface ProgramSub {
  program: boolean;
  status: string;
}

const LIVE = new Set(["active", "trialing", "past_due"]);
const NEVER_STARTED = new Set(["incomplete", "incomplete_expired"]);

/** Paying right now (or retrying a failed payment). */
export const isProgramMember = (subs: ProgramSub[]) => subs.some((s) => s.program && LIVE.has(s.status));

/** Has ever paid into the program, including members who have since cancelled. */
export const hasJoinedProgram = (subs: ProgramSub[]) => subs.some((s) => s.program && !NEVER_STARTED.has(s.status));

/** When a November fee client's month runs out (start of that day, Central), or null. */
export function legacyRetainerEnds(email: string | null | undefined): Date | null {
  const ymd = LEGACY_RETAINER_UNTIL[(email ?? "").trim().toLowerCase()];
  return ymd ? new Date(`${ymd}T06:00:00Z`) : null;
}

/** A November fee client past their renewal date who hasn't joined: no leads, no top-ups. */
export function mustJoinProgram(email: string | null | undefined, subs: ProgramSub[], now = new Date()): boolean {
  const ends = legacyRetainerEnds(email);
  return !!ends && now >= ends && !hasJoinedProgram(subs);
}
