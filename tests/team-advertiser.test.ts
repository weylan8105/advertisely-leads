import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Join defaults on a team whose members advertise under the owner's November
 * fee (lib/teamAdvertiser.ts): Goldmine off + advertiser on the shared pool,
 * only while that fee runs. SYNTHETIC data, mocked prisma.
 */
const users: Record<string, any> = {};
const orgs: Record<string, any> = {};
const memberships: any[] = [];
const payments: any[] = [];
const tx = {
  $executeRaw: vi.fn(async () => 0),
  adSpendPayment: {
    findFirst: vi.fn(async ({ where }: any) => payments.find((p) => p.userId === where.userId && p.note.includes(where.note.contains)) ?? null),
    create: vi.fn(async ({ data }: any) => { payments.push(data); return data; }),
  },
};
const db = {
  ...tx,
  $transaction: vi.fn(async (fn: any) => fn(tx)),
  organization: { findUnique: vi.fn(async ({ where }: any) => orgs[where.id] ?? null) },
  membership: {
    updateMany: vi.fn(async ({ where, data }: any) => {
      const hit = memberships.filter((m) => m.organizationId === where.organizationId && m.userId === where.userId);
      hit.forEach((m) => Object.assign(m, data));
      return { count: hit.length };
    }),
  },
  user: {
    findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null),
    update: vi.fn(async ({ where, data }: any) => Object.assign(users[where.id], data)),
  },
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
vi.mock("@/lib/adSpend", () => ({ SHARED_POOL_ONLY: "shared-pool", forgetAdSpendSummary: vi.fn() }));

const { applyTeamJoinDefaults, teamAdvertiserActive, membersFundThemselves, creditOwnSpendFromTeamCheckout } = await import("@/lib/teamAdvertiser");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
  for (const k of Object.keys(users)) delete users[k];
  memberships.length = 0;
  payments.length = 0;
  orgs.JACE_TEAM = { ownerId: "JACE", owner: { email: "jljensen38@gmail.com" } };
  orgs.OTHER_TEAM = { ownerId: "DAVE", owner: { email: "dclayton1235@gmail.com" } };
  users.NEW = { isAdvertiser: false, adCampaignIds: [] };
  memberships.push({ organizationId: "JACE_TEAM", userId: "NEW", goldmineBlocked: false }, { organizationId: "OTHER_TEAM", userId: "NEW", goldmineBlocked: false });
});

describe("team join defaults", () => {
  it("joining Jace's team: Goldmine off and an advertiser on the shared pool", async () => {
    expect(await applyTeamJoinDefaults("NEW", "JACE_TEAM")).toBe(true);
    expect(memberships[0].goldmineBlocked).toBe(true);
    expect(users.NEW).toEqual({ isAdvertiser: true, adCampaignIds: ["shared-pool"] });
  });

  it("an existing advertiser keeps their campaigns", async () => {
    users.NEW = { isAdvertiser: true, adCampaignIds: ["123"] };
    await applyTeamJoinDefaults("NEW", "JACE_TEAM");
    expect(users.NEW.adCampaignIds).toEqual(["123"]);
    expect(memberships[0].goldmineBlocked).toBe(true);
  });

  it("other teams, and the owner himself, are untouched", async () => {
    expect(await applyTeamJoinDefaults("NEW", "OTHER_TEAM")).toBe(false);
    expect(await applyTeamJoinDefaults("JACE", "JACE_TEAM")).toBe(false);
    expect(memberships[1].goldmineBlocked).toBe(false);
    expect(users.NEW.isAdvertiser).toBe(false);
  });

  it("stops once Jace's November fee has run out (Dec 2)", async () => {
    expect(teamAdvertiserActive("jljensen38@gmail.com", new Date("2026-12-02T05:59:00Z"))).toBe(true);
    expect(teamAdvertiserActive("jljensen38@gmail.com", new Date("2026-12-02T06:00:00Z"))).toBe(false);
    vi.setSystemTime(new Date("2026-12-05T18:00:00Z"));
    expect(await applyTeamJoinDefaults("NEW", "JACE_TEAM")).toBe(false);
    expect(memberships[0].goldmineBlocked).toBe(false);
    expect(users.NEW.isAdvertiser).toBe(false);
  });
});

describe("a member's ad spend on Jace's team is their own", () => {
  it("the fund-your-upline path is closed for his team, before and after his fee ends", () => {
    expect(membersFundThemselves("JLJensen38@gmail.com ")).toBe(true);
    expect(membersFundThemselves("dclayton1235@gmail.com")).toBe(false);
    expect(membersFundThemselves(null)).toBe(false);
  });

  it("a payment made through the old team checkout lands on the member's own balance, once", async () => {
    const pay = { userId: "NEW", grossCents: 125_000, processingFeeCents: 3_750, stripeRef: "pi_1" };
    expect(await creditOwnSpendFromTeamCheckout(pay)).toBe(true);
    expect(await creditOwnSpendFromTeamCheckout(pay)).toBe(false); // webhook retry
    expect(payments).toEqual([
      expect.objectContaining({ userId: "NEW", amountCents: 121_250, method: "other", note: expect.stringContaining("team-checkout:pi_1") }),
    ]);
    expect(users.NEW).toEqual({ isAdvertiser: true, adCampaignIds: ["shared-pool"] });
  });
});
