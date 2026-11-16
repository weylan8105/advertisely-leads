/**
 * Teams whose management fee is on money PAID IN, not on campaign spend
 * (owner agreement, Nov 16 2026): once the advertiser and their team members
 * together pay more than $15,000 of ad spend in a calendar month (Central
 * time), 20% of every dollar past that line comes off the payer's balance.
 * See lib/teamPaidInFee.ts. No imports here so lib/adSpend.ts can read it.
 */
export interface PaidInFeeTeam {
  /** The upline advertiser; their team members are found from it. */
  advertiserId: string;
  /** Payments made at or before this time were settled by hand. */
  settledThrough: string;
}

export const PAID_IN_FEE_TEAMS: PaidInFeeTeam[] = [
  // Jace Jensen. November's first $17,100 was settled with a $420 charge on
  // his own balance (Nov 16, 06:28 UTC).
  { advertiserId: "cmvzxhs4x0003l1085fm43fkq", settledThrough: "2026-11-16T06:28:52.691Z" },
];

/** This advertiser pays the fee on money paid in, so none on campaign spend. */
export const isPaidInFeeAdvertiser = (userId: string) => PAID_IN_FEE_TEAMS.some((t) => t.advertiserId === userId);
