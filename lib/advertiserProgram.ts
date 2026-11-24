// ─── Advertisely Advertiser Program (owner directive, Nov 15–16 2026) ───────
// Anyone can become an advertiser from the marketplace. Two separate things:
//  - $500 every 2 weeks is the fee to be IN the program. None of it buys leads.
//  - Ad spend is added on its own, any amount, from the dashboard. It buys leads
//    from the shared pool (lib/sharedPool.ts) at the source campaign's cost per
//    lead plus a 20% management fee plus the 3% card fee (owner: the card fee
//    goes on their cost per lead, not on us). Ad spend is credited in full.
// A member who stops paying keeps getting leads until the 2 weeks they paid
// for run out. Then leads stop, and their unused ad spend waits on their
// account for when they rejoin.
//
// Billing is a Stripe subscription (metadata.kind = ADVERTISER_PROGRAM_KIND).
// Stripe is the record of who is a member; nothing about membership is stored
// in our database.
//
// Clients who paid the $3,000 monthly Advertisely Advertiser fee for November
// keep their setup until their renewal date. From then on they get leads only
// as Program members (owner: "leads stop until they join").

export const ADVERTISER_PROGRAM_KIND = "advertiser-program";

export const ADVERTISER_PROGRAM = {
  name: "Advertisely Advertiser Program",
  amountCents: 50_000, // the membership, every 2 weeks; separate from ad spend
  intervalWeeks: 2,
  managementRate: 0.2, // added to each lead's cost
  cardFeeRate: 0.03, // added to each lead's cost
};

// Renewal date of each client's November $3,000 fee (email → YYYY-MM-DD, Central).
export const LEGACY_RETAINER_UNTIL: Record<string, string> = {
  "angeloo.rodriguez05@gmail.com": "2026-12-01", // $500 + $2,500 (Nov 1)
  "jljensen38@gmail.com": "2026-12-02", // $3,000 (Nov 2)
  "dclayton1235@gmail.com": "2026-12-03", // $3,000 (Nov 3)
};

// Teams whose members advertise under the owner's November fee (owner directive,
// Nov 16 2026): joining one makes you an advertiser on the shared pool with
// Goldmine off (lib/teamAdvertiser.ts), and you are covered until the owner's
// renewal date above. After it you need the Program for leads, like the owner.
export const LEGACY_TEAM_ADVERTISER_OWNERS = new Set<string>(["jljensen38@gmail.com"]);

// ─── Enhanced Wealth team: membership fee waived (owner directive, Nov 16 2026) ───
// "Waive the $500 fee for anybody who tries to join on the Enhanced Wealth team,
// visibly show on their account that the fee is waived." The Enhanced Wealth team
// is Ryan's team in the app. Its members join with a Stripe subscription carrying
// a 100%-off coupon (metadata.feeWaived = FEE_WAIVER.key), so a waived membership
// works exactly like a paid one: same Stripe record, same leads, same price per
// lead (cost + 20% + 3%). Only the $500 membership is waived. The waiver belongs
// to being on the team: someone who leaves it stops counting as a member on the
// waived subscription, and joins again at the regular price.
export const FEE_WAIVER = {
  key: "enhanced-wealth",
  label: "Enhanced Wealth team",
  teamIds: new Set<string>(["cmsdc9be50001l4045uljpthc"]), // Ryan's Team
  couponId: "advertiser-program-enhanced-wealth",
};

/** Is any of these teams one whose members join with the membership waived? */
export const onFeeWaiverTeam = (teamIds: (string | null | undefined)[]) => teamIds.some((id) => !!id && FEE_WAIVER.teamIds.has(id));

/**
 * The membership fees a waived member hasn't paid so far: one for each 2-week
 * period started since they joined, the current one included.
 */
export function waivedSavingsCents(startedAt: Date | string | null | undefined, now = new Date()): number {
  if (!startedAt) return 0;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start) || start > now.getTime()) return 0;
  const periodMs = ADVERTISER_PROGRAM.intervalWeeks * 7 * 864e5;
  return (Math.floor((now.getTime() - start) / periodMs) + 1) * ADVERTISER_PROGRAM.amountCents;
}

// ─── One-time promo codes (owner directive, Nov 16 2026) ─────────────────────
// A code gives one account its first weeks in the program free, as a Stripe
// free trial: card on file, $0 today, then the regular $500 every 2 weeks. A
// code works only on the account it names, and only for someone who has never
// been in the program, so it can't be used twice or handed to someone else.
// noManagementFeeCents: the member's shared leads skip the 20% management fee
// (they still pay the cost per lead + the 3% card fee) until their shared-lead
// charges since joining reach this amount.
// freeUntil (YYYY-MM-DD, Central): the first payment falls on that day whenever
// they join (free days = days left until then); used instead of freeDays.
export const PROGRAM_PROMO_CODES: Record<
  string,
  { userId: string; freeDays: number; freeUntil?: string; noManagementFeeCents?: number; why: string }
> = {
  // Luke Scheffers paid the owner $1,000 directly: one full month (two memberships) free.
  LUKE1000: { userId: "cmu1muk4m0000jp043c27hqht", freeDays: 28, why: "paid $1,000 directly (Nov 2026)" },
  // David Layton paid the $3,000 November fee up front (owner, Nov 18 2026): his first
  // 4 weeks (two memberships) free, and his first $15,000 of ad spend without the management fee.
  DAVID3000: {
    userId: "cmw2i7yr40000jp071hed4rll",
    freeDays: 28,
    noManagementFeeCents: 1_500_000,
    why: "paid the $3,000 November fee up front (Nov 2026)",
  },
  // Jace Jensen paid $1,667 (prorated) on Nov 11 for AI creatives (owner, Nov 24 2026):
  // $1,000 of it went to his ad spend (a manual AdSpendPayment), the rest covers the
  // membership until Dec 8, when his first $500 is charged.
  JACE1667: {
    userId: "cmvzxhs4x0003l1085fm43fkq",
    freeDays: 0,
    freeUntil: "2026-12-08",
    why: "paid $1,667 (prorated) for AI creatives on Nov 11 (Nov 2026)",
  },
};

export const normalizePromoCode = (code: unknown) => String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Check a promo code for this account: the free days it gives, or why it can't be used. */
export function programPromo(
  code: unknown,
  userId: string,
  subs: ProgramSub[],
  now = new Date(),
): { ok: true; code: string; freeDays: number } | { ok: false; error: string } {
  const key = normalizePromoCode(code);
  const promo = PROGRAM_PROMO_CODES[key];
  if (!promo || promo.userId !== userId) return { ok: false, error: "That promo code isn't valid for this account." };
  if (hasJoinedProgram(subs)) return { ok: false, error: "That promo code has already been used." };
  // A set first-payment date: the days left until it (0 once it has passed: they pay today).
  const freeDays = promo.freeUntil
    ? Math.max(0, Math.ceil((new Date(`${promo.freeUntil}T06:00:00Z`).getTime() - now.getTime()) / 864e5))
    : promo.freeDays;
  return { ok: true, code: key, freeDays };
}

/** The shared-lead spend a member's promo code gives without the management fee (cents), or 0. */
export function promoNoManagementFeeCents(code: unknown, userId: string): number {
  const promo = PROGRAM_PROMO_CODES[normalizePromoCode(code)];
  return promo && promo.userId === userId ? promo.noManagementFeeCents ?? 0 : 0;
}

/**
 * A member's price for a lead: the campaign's cost per lead, plus the management
 * fee (unless their promo code waives it for now), plus the card fee.
 */
export const programLeadPriceCents = (cplCents: number, o: { noManagementFee?: boolean } = {}) =>
  Math.round(cplCents * (1 + (o.noManagementFee ? 0 : ADVERTISER_PROGRAM.managementRate)) * (1 + ADVERTISER_PROGRAM.cardFeeRate));

/** A Stripe subscription as the program checks it (ClientSubscription in lib/adSpend.ts fits). */
export interface ProgramSub {
  program: boolean;
  status: string;
  feeWaived?: boolean; // joined with the membership waived (FEE_WAIVER)
}

/**
 * Whether the user is on the fee-waiver team right now. Left out, a waived
 * membership counts (never cut someone's leads on a check that wasn't made);
 * false means they have left the team, so a waived membership no longer counts.
 */
export interface WaiverOpts {
  onWaiverTeam?: boolean;
}

const counts = (s: ProgramSub, o: WaiverOpts) => !(s.feeWaived && o.onWaiverTeam === false);

const LIVE = new Set(["active", "trialing", "past_due"]);
const NEVER_STARTED = new Set(["incomplete", "incomplete_expired"]);

/** In the program right now: paying, fee waived, or retrying a failed payment. */
export const isProgramMember = (subs: ProgramSub[], o: WaiverOpts = {}) =>
  subs.some((s) => s.program && LIVE.has(s.status) && counts(s, o));

/** A live waived membership that no longer counts because they left the team. */
export const waiverEnded = (subs: ProgramSub[], o: WaiverOpts = {}) =>
  !isProgramMember(subs, o) && subs.some((s) => s.program && LIVE.has(s.status) && s.feeWaived && o.onWaiverTeam === false);

/** Has ever been in the program, including members whose membership has since ended. */
export const hasJoinedProgram = (subs: ProgramSub[]) => subs.some((s) => s.program && !NEVER_STARTED.has(s.status));

/** When a November fee client's month runs out (start of that day, Central), or null. */
export function legacyRetainerEnds(email: string | null | undefined): Date | null {
  const ymd = LEGACY_RETAINER_UNTIL[(email ?? "").trim().toLowerCase()];
  return ymd ? new Date(`${ymd}T06:00:00Z`) : null;
}

/**
 * When this account's cover runs out: their own November fee, or (viaTeam) the
 * fee of an upline whose team members advertise under it. Null = no cover.
 */
export function legacyCoverEnds(
  email: string | null | undefined,
  uplineEmails: (string | null | undefined)[] = [],
): { ends: Date; viaTeam: boolean } | null {
  const own = legacyRetainerEnds(email);
  if (own) return { ends: own, viaTeam: false };
  const team = uplineEmails
    .filter((e) => LEGACY_TEAM_ADVERTISER_OWNERS.has((e ?? "").trim().toLowerCase()))
    .map((e) => legacyRetainerEnds(e))
    .filter((d): d is Date => !!d);
  if (!team.length) return null;
  return { ends: new Date(Math.max(...team.map((d) => d.getTime()))), viaTeam: true };
}

/**
 * No leads and no ad-spend top-ups until they join (or rejoin) the Program:
 *  - a November fee client past their renewal date,
 *  - a member of such a client's team past that same date,
 *  - a shared-pool-only advertiser with no cover at all (they left that team),
 *  - a member whose membership has ended (their unused ad spend waits).
 * A paying member is never held back, and neither is anyone still inside
 * their November cover.
 */
export function mustJoinProgram(
  email: string | null | undefined,
  subs: ProgramSub[],
  now = new Date(),
  opts: { uplineEmails?: (string | null | undefined)[]; sharedPoolOnly?: boolean } & WaiverOpts = {},
): boolean {
  if (isProgramMember(subs, opts)) return false;
  const cover = legacyCoverEnds(email, opts.uplineEmails);
  if (cover) return now >= cover.ends;
  return !!opts.sharedPoolOnly || hasJoinedProgram(subs);
}
