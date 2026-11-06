import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = {
  user: { findUnique: vi.fn() },
  lead: { findMany: vi.fn(), groupBy: vi.fn() },
  organization: { findUnique: vi.fn(), update: vi.fn() },
  membership: { findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));

import { advertiserTeamRecipient } from "@/lib/advertiserVolume";

const member = (userId: string, licensedStates: string[] = []) => ({ userId, user: { licensedStates } });
function setup(keep: number | null, kept: number, org: Record<string, unknown> | null) {
  prismaMock.user.findUnique.mockResolvedValue({ advertiserWeeklyKeep: keep });
  prismaMock.lead.findMany.mockResolvedValue(Array.from({ length: kept }, () => ({ assignedAt: new Date() })));
  prismaMock.organization.findUnique.mockResolvedValue(org);
}

describe("advertiserTeamRecipient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps every lead when no amount is set", async () => {
    setup(null, 0, { ownerId: "adv", distributionMode: "MANUAL", rrCursor: 0, memberships: [member("a1")] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toBeNull();
  });

  it("no amount on a round-robin team: each lead goes to the next licensed member", async () => {
    const memberships = [member("adv"), member("a1", ["TX"]), member("a2")];
    setup(null, 0, { ownerId: "adv", distributionMode: "ROUND_ROBIN", rrCursor: 1, memberships });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toEqual({ userId: "a1", byQuota: false, byRotation: true });
    expect(prismaMock.organization.update).toHaveBeenCalledWith({ where: { id: "org" }, data: { rrCursor: 2 } });
  });

  it("round-robin: the advertiser's own turn keeps the lead and moves the rotation on", async () => {
    setup(null, 0, { ownerId: "adv", distributionMode: "ROUND_ROBIN", rrCursor: 3, memberships: [member("adv"), member("a1"), member("a2")] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toBeNull();
    expect(prismaMock.organization.update).toHaveBeenCalledWith({ where: { id: "org" }, data: { rrCursor: 4 } });
  });

  it("round-robin: skips members not licensed in the state", async () => {
    setup(null, 0, { ownerId: "adv", distributionMode: "ROUND_ROBIN", rrCursor: 1, memberships: [member("adv", ["FL"]), member("a1", ["CA"]), member("a2")] });
    // a1 isn't licensed in FL → pool [adv, a2]; cursor 1 → a2
    expect(await advertiserTeamRecipient("adv", "org", "FL")).toEqual({ userId: "a2", byQuota: false, byRotation: true });
  });

  it("round-robin: an advertiser out of rotation never takes a turn", async () => {
    setup(null, 0, { ownerId: "adv", distributionMode: "ROUND_ROBIN", rrCursor: 0, memberships: [member("a1"), member("a2")] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toEqual({ userId: "a1", byQuota: false, byRotation: true });
  });

  it("round-robin: nobody licensed in the state, the advertiser keeps it", async () => {
    setup(null, 0, { ownerId: "adv", distributionMode: "ROUND_ROBIN", rrCursor: 0, memberships: [member("adv", ["FL"]), member("a1", ["CA"])] });
    expect(await advertiserTeamRecipient("adv", "org", "WY")).toBeNull();
    expect(prismaMock.organization.update).not.toHaveBeenCalled();
  });

  it("past a keep amount the advertiser stays out of the rotation", async () => {
    setup(0, 0, { ownerId: "adv", distributionMode: "ROUND_ROBIN", rrCursor: 0, memberships: [member("adv"), member("a1")] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toEqual({ userId: "a1", byQuota: false, byRotation: false });
  });

  it("keeps the lead while under the amount", async () => {
    setup(5, 4, { ownerId: "adv", distributionMode: "MANUAL", rrCursor: 0, memberships: [member("a1")] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toBeNull();
  });

  it("zeroed out: every lead round-robins to licensed teammates", async () => {
    setup(0, 0, { ownerId: "adv", distributionMode: "MANUAL", rrCursor: 1, memberships: [member("a1"), member("a2", ["FL"]), member("a3", ["TX"])] });
    // a2 isn't licensed in TX → pool [a1, a3]; cursor 1 → a3
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toEqual({ userId: "a3", byQuota: false, byRotation: false });
    expect(prismaMock.organization.update).toHaveBeenCalledWith({ where: { id: "org" }, data: { rrCursor: 2 } });
  });

  it("past the amount on a weekly-amounts team: goes by quota", async () => {
    setup(2, 2, { ownerId: "adv", distributionMode: "WEEKLY_QUOTA", rrCursor: 0, memberships: [member("a1")] });
    prismaMock.membership.findMany.mockResolvedValue([{ userId: "q1", weeklyLeadQuota: 10, user: { licensedStates: [] } }]);
    prismaMock.lead.groupBy.mockResolvedValue([]);
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toEqual({ userId: "q1", byQuota: true });
  });

  it("nobody can take it (no licensed teammates): advertiser keeps it", async () => {
    setup(0, 0, { ownerId: "adv", distributionMode: "MANUAL", rrCursor: 0, memberships: [member("a1", ["FL"])] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toBeNull();
  });

  it("only applies to the team the advertiser owns", async () => {
    setup(0, 0, { ownerId: "someone-else", distributionMode: "MANUAL", rrCursor: 0, memberships: [member("a1")] });
    expect(await advertiserTeamRecipient("adv", "org", "TX")).toBeNull();
  });
});
