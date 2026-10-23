// One-time in-app announcements. Each shows exactly once per user, then never
// again (tracked by key in User.announcementsSeen). To add a new announcement,
// append an entry with a fresh, stable `key`. Only the first still-unseen entry
// is shown at a time.

import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { findPackage } from "@/data/packages";
import { BUCKS_PER_REFERRED_LEAD_CENTS, REFERRAL_DISCOUNT_RATE, priceCart } from "@/lib/referralPricing";

// Advertisely Bucks numbers come from the live pricing so the copy never drifts.
const freshList = findPackage("iul-fresh")?.pricePerLead ?? 0;
const freshWithCode = priceCart([{ packageId: "iul-fresh", quantity: 1 }], { codeApplied: true }).subtotalCents / 100;
const perLeadEarn = BUCKS_PER_REFERRED_LEAD_CENTS / 100;
const pctOff = Math.round(REFERRAL_DISCOUNT_RATE * 100);
// "$67" for whole dollars, "$60.30" otherwise.
const usd = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);

export interface Announcement {
  key: string;
  title: string;
  /** Short intro line under the title. */
  body: string;
  /** Up to a few bullet highlights. */
  highlights?: string[];
  ctaLabel: string;
  ctaHref: string;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    key: "goldmine-2026-10",
    title: "Introducing Goldmine 💎",
    body: "A brand-new, team-shared pipeline for your aged leads — so nothing you've paid for goes to waste.",
    highlights: [
      "Your older leads move into Goldmine automatically (you choose after how many days — 30 by default).",
      "Your whole downline can work and close them — dial, text, and move them through the stages.",
      "Every close still counts toward your conversions and P&L.",
    ],
    ctaLabel: "Explore Goldmine",
    ctaHref: "/goldmine",
  },
  // Advertisely Bucks Marketing Campaign — only while the program is on.
  ...(REFERRAL_PROGRAM_ENABLED
    ? [
        {
          key: "advertisely-bucks-2026-10",
          title: "Get free leads with Advertisely Bucks 💵",
          body: "You now have your own referral code. Share it with other agents and earn free leads every time they order.",
          highlights: [
            `Every fresh lead someone buys with your code puts $${perLeadEarn} in Advertisely Bucks in your account. One 25-lead order = $${25 * perLeadEarn} toward your next leads.`,
            "Pay for your own lead orders with Bucks. Earn enough and your next order is free, no card needed.",
            "No limit. The more agents you share your code with, the more free leads you get.",
            `They win too: your code gets them ${pctOff}% off fresh leads (${usd(freshWithCode)} instead of ${usd(freshList)}).`,
          ],
          ctaLabel: "Get my code",
          ctaHref: "/rewards",
        },
      ]
    : []),
];

export function findAnnouncement(key: string): Announcement | undefined {
  return ANNOUNCEMENTS.find((a) => a.key === key);
}
