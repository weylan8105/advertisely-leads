import { describe, it, expect, beforeEach } from "vitest";
import { advertiserInviteToken, isAdvertiserInviteToken } from "@/lib/advertiserInvite";

describe("advertiser invite token", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret";
    delete process.env.ADVERTISER_INVITE_VERSION;
  });

  it("accepts the real token and rejects others", () => {
    const t = advertiserInviteToken()!;
    expect(t).toHaveLength(24);
    expect(isAdvertiserInviteToken(t)).toBe(true);
    expect(isAdvertiserInviteToken(t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"))).toBe(false);
    expect(isAdvertiserInviteToken("")).toBe(false);
    expect(isAdvertiserInviteToken(undefined)).toBe(false);
  });

  it("changing the version retires old links", () => {
    const old = advertiserInviteToken()!;
    process.env.ADVERTISER_INVITE_VERSION = "v2";
    expect(isAdvertiserInviteToken(old)).toBe(false);
  });
});
