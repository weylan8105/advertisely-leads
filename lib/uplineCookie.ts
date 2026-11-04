/**
 * Cookie that carries an upline code through "Sign up with Google": the signup
 * page sets it, lib/auth.ts reads it when the new account is created.
 */
export const UPLINE_COOKIE = "adv_upline";

/** Same for the advertiser invite link (lib/advertiserInvite.ts). */
export const ADVERTISER_COOKIE = "adv_advertiser";
