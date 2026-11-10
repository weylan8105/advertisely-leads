// The platform owners (Ryan + Weylan). The app has no site-wide "owner" role —
// only site ADMIN and per-team OWNER — so owner-only features gate on these
// emails. HOUSE_ACCOUNT_EMAIL (Ryan) is the house account; Weylan is co-owner.
// Client-safe: emails only, no secrets.
export const LEAD_COST_OWNER_EMAILS: readonly string[] = [
  (process.env.NEXT_PUBLIC_HOUSE_ACCOUNT_EMAIL || "ryanrush129@gmail.com").trim().toLowerCase(),
  "weylanw@gmail.com",
];

/** True when the given email is a platform owner (Ryan or Weylan). */
export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && LEAD_COST_OWNER_EMAILS.includes(email.trim().toLowerCase());
}
