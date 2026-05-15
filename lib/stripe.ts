import Stripe from "stripe";

export const isStripeConfigured = !!process.env.STRIPE_SECRET_KEY;

// Server-side Stripe client. Null until secret key is in env.
export const stripe = isStripeConfigured
  ? new Stripe(process.env.STRIPE_SECRET_KEY!, {
      typescript: true,
      appInfo: {
        name: "Advertisely Leads",
        url: "https://advertisely.io",
      },
    })
  : null;

export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
