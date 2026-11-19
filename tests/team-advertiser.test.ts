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
const ledger: any[] = [];
const tx = {
  teamAdSpend: {
    findMany: vi.fn(async ({ where }: any) => ledger.filter((r) => r.advertiserId === where.advertiserId && r.userId === where.userId)),
    create: vi.fn(async ({ data }: any) => { ledger.push(data); return data; }),
  },
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
      const hit = memberships.filter((m) =>
        m.userId === where.userId &&
        (where.organization ? orgs[m.organizationId]?.ownerId === where.organization.ownerId : m.organizationId === where.organizationId));
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

const {
  applyTeamJoinDefaults, teamAdvertiserActive, membersFundThemselves, creditOwnSpendFromTeamCheckout,
  teamFundingClosedReason, uplineCampaignFundable, moveStrandedTeamCredit,
} = await import("@/lib/teamAdvertiser");
const { HOUSE_EMAIL } = await import("@/lib/housePause");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T18:00:00Z"));
  for (const k of Object.keys(users)) delete users[k];
  memberships.length = 0;
  payments.length = 0;
  ledger.length = 0;
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

describe("a member can only add spend to a campaign that can deliver leads for it", () => {
  const own = { email: "dclayton1235@gmail.com", isAdvertiser: true, adCampaignIds: [] as string[] };

  it("open for an advertiser who runs a campaign of their own", () => {
    expect(teamFundingClosedReason(own)).toBeNull();
    expect(uplineCampaignFundable({ ...own, adCampaignIds: ["120250000000000001"] })).toBe(true);
  });

  it("closed for the house: Ryan's leads come from his round-robin turn, never from team credit", () => {
    expect(teamFundingClosedReason({ ...own, email: ` ${HOUSE_EMAIL.toUpperCase()} ` })).toBe("house");
  });

  it("closed for an upline with no campaign of their own (shared pool only)", () => {
    expect(teamFundingClosedReason({ ...own, adCampaignIds: ["shared-pool"] })).toBe("shared-pool-only");
  });

  it("closed where members fund themselves, for a non-advertiser, and for nobody", () => {
    expect(teamFundingClosedReason({ ...own, email: "jljensen38@gmail.com" })).toBe("members-fund-themselves");
    expect(teamFundingClosedReason({ ...own, isAdvertiser: false })).toBe("not-advertiser");
    expect(uplineCampaignFundable(null)).toBe(false);
  });

  it("credit stranded on such a campaign moves to the member's own balance, once, and the switch goes off", async () => {
    orgs.HOUSE_TEAM = { ownerId: "HOUSE", owner: { email: HOUSE_EMAIL } };
    memberships.push({ organizationId: "HOUSE_TEAM", userId: "NEW", adSpendAccess: true });
    ledger.push({ advertiserId: "HOUSE", userId: "NEW", kind: "payment", amountCents: 24_250 });
    const p = { userId: "NEW", advertiserId: "HOUSE", advertiserName: "The House" };
    expect(await moveStrandedTeamCredit(p)).toBe(24_250);
    expect(await moveStrandedTeamCredit(p)).toBe(0); // nothing left to move
    expect(ledger.reduce((s, r) => s + r.amountCents, 0)).toBe(0);
    expect(ledger[1]).toEqual(expect.objectContaining({ kind: "moved-out", amountCents: -24_250 }));
    expect(payments).toEqual([
      expect.objectContaining({ userId: "NEW", amountCents: 24_250, method: "other", note: expect.stringContaining("moved from The House's campaign") }),
    ]);
    expect(memberships.find((m) => m.organizationId === "HOUSE_TEAM").adSpendAccess).toBe(false);
    expect(users.NEW).toEqual({ isAdvertiser: true, adCampaignIds: ["shared-pool"] });
  });

  it("credit that includes money paid to the upline directly is left for a person to decide", async () => {
    ledger.push(
      { advertiserId: "HOUSE", userId: "NEW", kind: "direct-payment", amountCents: 50_000 },
      { advertiserId: "HOUSE", userId: "NEW", kind: "payment", amountCents: 10_000 },
    );
    expect(await moveStrandedTeamCredit({ userId: "NEW", advertiserId: "HOUSE", advertiserName: "The House" })).toBe(0);
    expect(payments).toEqual([]);
    expect(ledger).toHaveLength(2);
  });
});
