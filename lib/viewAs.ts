/**
 * Admin "view as client": an admin opens a client's (or advertiser's) account
 * and sees the app exactly as that client does, read-only.
 *
 * The cookie holds the client's user id. It does nothing on its own: the
 * session callback in lib/auth.ts only honors it when the signed session token
 * already says ADMIN, so setting it by hand gives nobody anything. While it is
 * set, middleware.ts refuses every change (see isBlockedWhileViewing), so the
 * admin can look around but can't buy, edit, move leads or text as the client.
 */
export const VIEW_AS_COOKIE = "adv_view_as";

/** Falls back to the admin's own view on its own after 2 hours. */
export const VIEW_AS_MAX_AGE_SECONDS = 60 * 60 * 2;

export const VIEW_ONLY_MESSAGE =
  "View only: you're looking at a client's account. Exit client view to make changes.";

export function viewAsTargetId(tokenRole: string | null | undefined, cookieValue: string | null | undefined) {
  if (tokenRole !== "ADMIN" || !cookieValue) return null;
  const id = cookieValue.trim();
  return /^[A-Za-z0-9_-]{6,64}$/.test(id) ? id : null;
}

/** API paths that start a change on the client's account even with GET. */
const GET_BLOCKED = [/^\/api\/integrations\/google-calendar\/(connect|callback)\/?$/];

/**
 * True when a request has to be refused because the admin is only viewing.
 * Every non-read API call is refused, except starting/ending client view and
 * NextAuth itself (sign-out, session).
 */
export function isBlockedWhileViewing(method: string, pathname: string) {
  if (!pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/api/admin/view-as") || pathname.startsWith("/api/auth/")) return false;
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD" || m === "OPTIONS") return GET_BLOCKED.some((r) => r.test(pathname));
  return true;
}
