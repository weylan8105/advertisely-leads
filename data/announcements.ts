// One-time in-app announcements. Each shows exactly once per user, then never
// again (tracked by key in User.announcementsSeen). To add a new announcement,
// append an entry with a fresh, stable `key`. Only the first still-unseen entry
// is shown at a time.

import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { findPackage } from "@/data/packages";
import { BUCKS_PER_REFERRED_LEAD_CENTS, priceCart } from "@/lib/referralPricing";

// Advertisely Bucks numbers come from the live pricing so the copy never drifts.
const freshList = findPackage("iul-fresh")?.pricePerLead ?? 0;
const freshWithCode = priceCart([{ packageId: "iul-fresh", quantity: 1 }], { codeApplied: true }).subtotalCents / 100;
const perLeadEarn = BUCKS_PER_REFERRED_LEAD_CENTS / 100;

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
          title: "Introducing Advertisely Bucks 💵",
          body: "You now have your own referral code. Share it: your friends save on fresh leads, and you earn free leads.",
          highlights: [
            `Anyone who orders with your code pays $${freshWithCode} per fresh lead instead of $${freshList}.`,
            `You earn $${perLeadEarn} in Advertisely Bucks for every fresh lead they buy. 25 leads = $${25 * perLeadEarn}.`,
            "Spend your Bucks on your own lead orders. There's no limit on earning or spending.",
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
