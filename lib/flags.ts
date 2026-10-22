/**
 * Global kill switch for lead purchasing.
 *
 * When true, every buy path is blocked server-side (Stripe checkout intent +
 * direct order creation) and the storefront shows a paused notice. This is the
 * single source of truth shared by the API routes and the UI.
 *
 * To resume sales: set this to false and redeploy.
 */
export const LEADS_PURCHASE_PAUSED = false;

export const PURCHASE_PAUSED_MESSAGE =
  "Lead purchasing is paused right now. We'll be back online shortly — thanks for your patience.";

/**
 * Weekly "Subscribe & Save" lead subscription rollout.
 *
 * While false, the subscription page, nav link, and checkout are ADMIN-ONLY —
 * so the recurring-billing flow can be tested end-to-end (Stripe test mode +
 * confirm the webhook delivers checkout.session.completed / invoice.paid /
 * customer.subscription.*) before any real agent can subscribe and be charged.
 * Flip to true to open subscriptions to all agents.
 */
export const LEAD_SUBSCRIPTIONS_PUBLIC = true;

/**
 * TEMPORARY testing hold-back. Any incoming lead whose tags match one of these
 * (case-insensitive substring) is routed 100% to the house (Ryan) instead of
 * being distributed to buyers — so a new lead type's quality can be evaluated
 * before it's sold. Empty this array to turn the hold-back off and let that
 * lead type flow through normal distribution.
 *
 * Active: "American Income Advantage" leads (testing phase, Oct 2026).
 */
export const HOLDBACK_TAGS_TO_HOUSE = ["american income advantage"];

/**
 * Advertisely Bucks Marketing Campaign — LIVE since Oct 22, 2026.
 *
 * When true:
 *  - Fresh leads list at $66.67. Entering anyone's referral code at checkout
 *    takes 10% off fresh leads — exactly $60.00.
 *  - The code's owner earns $12 in Advertisely Bucks per fresh lead bought with
 *    it (no cap). Bucks pay for future lead orders, no cap either.
 *  - Platform ADMINs neither earn nor spend Bucks.
 *  - The Bucks balance shows in the top bar; /rewards manages the code.
 *
 * Schema (prisma/sql/referral_program.sql) and code backfill
 * (scripts/backfill-referral-codes.mjs) were applied at launch. Setting this
 * back to false hides the program and restores the $60 list price.
 */
export const REFERRAL_PROGRAM_ENABLED = true;
