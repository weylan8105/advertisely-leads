/**
 * Admin "user mode": an admin sees and is treated as a regular client until
 * they switch it off. The cookie can only ever lower access: it is ignored
 * unless the signed session token already says ADMIN, so setting it by hand
 * gives nobody anything.
 */
export const USER_MODE_COOKIE = "adv_user_mode";

/** Falls back to the admin view on its own after 12 hours. */
export const USER_MODE_MAX_AGE_SECONDS = 60 * 60 * 12;

export function isUserModeActive(tokenRole: string | null | undefined, cookieValue: string | null | undefined) {
  return tokenRole === "ADMIN" && cookieValue === "1";
}
