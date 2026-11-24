// One-time in-app announcements. Each shows exactly once per user, then never
// again (tracked by key in User.announcementsSeen). To add a new announcement,
// append an entry with a fresh, stable `key`. Only the first still-unseen entry
// is shown at a time.

import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { NURSE_LEAD_TYPE } from "@/lib/leadTypes";
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
  /** Where the button goes. Omit for a plain "Got it" that only closes it. */
  ctaHref?: string;
  /** Small label above the title (default "New feature"). */
  eyebrow?: string;
  /** Hide the "Maybe later" button (account notices, not feature promos). */
  noSecondary?: boolean;
  /** Only these accounts see it (User ids). Omit for everyone. */
  userIds?: string[];
  /** An itemized list of amounts, shown as a small table under the body. */
  breakdown?: { rows: { label: string; detail?: string; amount: string }[]; totalLabel: string; total: string; footnote?: string };
  /**
   * Who sees this. "all" (default) = every agent. "working_leads" = only agents
   * who currently have leads to work (an open order or assigned leads) — resolved
   * server-side in /api/announcements. "advertisers" = advertiser accounts only
   * (not the owners).
   */
  audience?: "all" | "working_leads" | "advertisers";
  /**
   * The button does this itself before closing: "enable-lead-type" switches
   * `leadType` on for the viewer (PUT /api/advertiser/lead-types { enable }).
   */
  ctaAction?: { kind: "enable-lead-type"; leadType: string; doneText: string };
}

// Jace Jensen's account (owner request, Nov 16 2026): his team passed the
// $15,000 November ad-spend line. Amounts are card amounts before the 3% fee.
const JACE_JENSEN_ID = "cmvzxhs4x0003l1085fm43fkq";

export const ANNOUNCEMENTS: Announcement[] = [
  {
    key: "jace-team-adspend-15k-2026-11",
    userIds: [JACE_JENSEN_ID],
    eyebrow: "Account update",
    noSecondary: true,
    title: "Your team passed $15,000 in November ad spend",
    body: "You and your team have added $17,100 in ad spend so far this November. That's past the $15,000 monthly limit, so per our agreement a 20% management fee is deducted from your team's ad spend above $15,000.",
    breakdown: {
      rows: [
        { label: "Jace Jensen", detail: "Includes the $2,400 Adrian, Marcos and Chris paid you directly", amount: "$6,100" },
        { label: "Jacob Moreno", amount: "$3,500" },
        { label: "Daniel Munoz", amount: "$3,000" },
        { label: "Marcos Mellado", amount: "$1,250" },
        { label: "James Wideman", amount: "$1,250" },
        { label: "Adrian Colman", amount: "$1,000" },
        { label: "Baylor Brown", amount: "$1,000" },
      ],
      totalLabel: "Team total, November",
      total: "$17,100",
      footnote: "Amounts are what each person paid, before the 3% card fee.",
    },
    ctaLabel: "Got it",
  },
  // Nurse leads launch (owner request, Nov 16 2026): every advertiser, once.
  {
    key: "nurse-leads-launch-2026-11",
    audience: "advertisers",
    eyebrow: "New lead type",
    title: "Nurse leads are live",
    body: "We just launched a new lead type: nurses and healthcare workers from our Essential Workers campaign. They're off until you turn them on.",
    highlights: [
      "Turn them on with the button below, or any time under Lead types on your dashboard.",
      "They come in the states you're licensed in, alongside your Blue Collar leads.",
      "Each one is charged from your ad spend, the same way as your other leads.",
    ],
    ctaLabel: "Turn on Nurse leads",
    ctaHref: "/dashboard#lead-types",
    ctaAction: {
      kind: "enable-lead-type",
      leadType: NURSE_LEAD_TYPE,
      doneText: "Nurse leads are on. You can switch them off any time under Lead types on your dashboard.",
    },
  },
  {
    key: "blue-collar-iul-script-2026-10",
    title: "New: Blue-Collar IUL Calling Script 📄",
    body: "A proven call script for working your Blue-Collar IUL leads — intro, discovery questions, golden statements, and objection handling.",
    highlights: [
      "Battle-tested flow: open the call, uncover the 'why', and stay assumptive through the close.",
      "Always one click away — find it on your Lead CRM page under “Calling script” whenever you need it.",
    ],
    ctaLabel: "Open the script",
    ctaHref: "/iul-closing-script.html",
    audience: "working_leads",
  },
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
