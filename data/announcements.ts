// One-time in-app announcements. Each shows exactly once per user, then never
// again (tracked by key in User.announcementsSeen). To add a new announcement,
// append an entry with a fresh, stable `key`. Only the first still-unseen entry
// is shown at a time.

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
];

export function findAnnouncement(key: string): Announcement | undefined {
  return ANNOUNCEMENTS.find((a) => a.key === key);
}
