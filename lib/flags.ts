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
