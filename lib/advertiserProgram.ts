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

/** A member's price for a lead: the campaign's cost per lead, plus the management fee, plus the card fee. */
export const programLeadPriceCents = (cplCents: number) =>
  Math.round(cplCents * (1 + ADVERTISER_PROGRAM.managementRate) * (1 + ADVERTISER_PROGRAM.cardFeeRate));

/** A Stripe subscription as the program checks it (ClientSubscription in lib/adSpend.ts fits). */
export interface ProgramSub {
  program: boolean;
  status: string;
}

const LIVE = new Set(["active", "trialing", "past_due"]);
const NEVER_STARTED = new Set(["incomplete", "incomplete_expired"]);

/** Paying right now (or retrying a failed payment). */
export const isProgramMember = (subs: ProgramSub[]) => subs.some((s) => s.program && LIVE.has(s.status));

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
  opts: { uplineEmails?: (string | null | undefined)[]; sharedPoolOnly?: boolean } = {},
): boolean {
  if (isProgramMember(subs)) return false;
  const cover = legacyCoverEnds(email, opts.uplineEmails);
  if (cover) return now >= cover.ends;
  return !!opts.sharedPoolOnly || hasJoinedProgram(subs);
}
