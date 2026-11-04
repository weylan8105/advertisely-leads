import crypto from "crypto";

/**
 * Advertiser invite link: /signup?advertiser=<token>. Anyone who creates an
 * account through it (email or Google) is marked User.isAdvertiser. The token is
 * an HMAC of the app secret, so it can't be guessed. Change
 * ADVERTISER_INVITE_VERSION to retire every link already shared.
 */

// The cookie that carries the token through "Sign up with Google" lives in
// lib/uplineCookie.ts (ADVERTISER_COOKIE) — the signup page can't import crypto.
export { ADVERTISER_COOKIE } from "./uplineCookie";

function secret(): string | null {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || null;
}

export function advertiserInviteToken(): string | null {
  const s = secret();
  if (!s) return null;
  const version = process.env.ADVERTISER_INVITE_VERSION || "v1";
  return crypto.createHmac("sha256", s).update(`advertiser-invite:${version}`).digest("hex").slice(0, 24);
}

export function isAdvertiserInviteToken(token: string | null | undefined): boolean {
  const expected = advertiserInviteToken();
  const got = (token ?? "").trim();
  if (!expected || got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
