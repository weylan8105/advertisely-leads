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
 * TEMPORARY testing hold-back. Any incoming lead whose tags match one of these
 * (case-insensitive substring) is routed 100% to the house (Ryan) instead of
 * being distributed to buyers — so a new lead type's quality can be evaluated
 * before it's sold. Empty this array to turn the hold-back off and let that
 * lead type flow through normal distribution.
 *
 * Active: "American Income Advantage" leads (testing phase, Oct 2026).
 */
export const HOLDBACK_TAGS_TO_HOUSE = ["american income advantage"];
