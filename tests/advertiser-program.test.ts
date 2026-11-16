import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Advertisely Advertiser Program (lib/advertiserProgram.ts + lib/advertiserProgramBilling.ts):
 * the fee math, the November fee clients' cutoff, crediting paid invoices once,
 * and the shared-pool price/gate. Mocked prisma, Stripe and ad-spend reads with
 * SYNTHETIC data; never touches a real DB or Stripe.
 */

const payments: any[] = [];
const users: Record<string, any> = {};
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
  user: {
    findUnique: vi.fn(async ({ where }: any) => users[where.id] ?? null),
    update: vi.fn(async ({ where, data }: any) => Object.assign(users[where.id], data)),
    findMany: vi.fn(async () => Object.values(users)),
  },
  leadSubscription: { upsert: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));

const subscriptionsRetrieve = vi.fn();
vi.mock("@/lib/stripe", () => ({ isStripeConfigured: true, stripe: { subscriptions: { retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a) } } }));

const getAdSpendSummary = vi.fn();
const enforceAdSpend = vi.fn(async () => ({ action: "none" }));
vi.mock("@/lib/adSpend", () => ({
  SHARED_POOL_ONLY: "shared-pool",
  SHARED_LEAD_METHOD: "shared-lead",
  getAdSpendSummary: (...a: unknown[]) => getAdSpendSummary(...a),
  enforceAdSpend: (...a: unknown[]) => enforceAdSpend(...a),
  forgetAdSpendSummary: vi.fn(),
}));
vi.mock("@/lib/house", () => ({ deliverLeadToOwner: vi.fn(async () => true) }));
vi.mock("@/lib/fulfillment", () => ({ fulfillOrder: vi.fn() }));

const program = await import("@/lib/advertiserProgram");
const { recordProgramInvoice } = await import("@/lib/advertiserProgramBilling");
const { upsertLocalSubscription } = await import("@/lib/leadSubscription");
const { sharedClientSlots, clientLeadPriceCents } = await import("@/lib/sharedPool");

const sub = (status: string, isProgram = true) => ({ program: isProgram, status });
const DEC = (d: number, h = 12) => new Date(Date.UTC(2026, 11, d, h));

beforeEach(() => {
  payments.length = 0;
  for (const k of Object.keys(users)) delete users[k];
  vi.clearAllMocks();
});

describe("program rules", () => {
  it("$500: $100 management fee, $400 to leads; leads cost +3% card fee", () => {
    expect(program.programFeeCents(50_000)).toBe(10_000);
    expect(program.programCreditCents(50_000)).toBe(40_000);
    expect(program.programLeadPriceCents(2_500)).toBe(2_575);
    expect(program.programLeadPriceCents(3_228)).toBe(3_325);
  });

  it("members: paying now vs ever joined", () => {
    expect(program.isProgramMember([sub("active")])).toBe(true);
    expect(program.isProgramMember([sub("past_due")])).toBe(true);
    expect(program.isProgramMember([sub("canceled")])).toBe(false);
    expect(program.isProgramMember([sub("active", false)])).toBe(false); // some other subscription
    expect(program.hasJoinedProgram([sub("canceled")])).toBe(true);
    expect(program.hasJoinedProgram([sub("incomplete"), sub("incomplete_expired")])).toBe(false);
  });

  it("November fee clients keep their setup until their renewal date, then must join", () => {
    const david = "dclayton1235@gmail.com";
    expect(program.legacyRetainerEnds(david)?.toISOString()).toBe("2026-12-03T06:00:00.000Z"); // midnight Central
    expect(program.mustJoinProgram(david, [], DEC(2))).toBe(false);
    expect(program.mustJoinProgram(david, [], DEC(3))).toBe(true);
    expect(program.mustJoinProgram("DClayton1235@gmail.com ", [], DEC(3))).toBe(true);
    expect(program.mustJoinProgram(david, [sub("active")], DEC(3))).toBe(false);
    expect(program.mustJoinProgram(david, [sub("canceled")], DEC(20))).toBe(false); // joined, then cancelled
    expect(program.mustJoinProgram(david, [sub("incomplete")], DEC(3))).toBe(true);
    expect(program.mustJoinProgram("someone@new.test", [], DEC(20))).toBe(false);
    expect(program.legacyRetainerEnds("jljensen38@gmail.com")?.toISOString().slice(0, 10)).toBe("2026-12-02");
    expect(program.legacyRetainerEnds("angeloo.rodriguez05@gmail.com")?.toISOString().slice(0, 10)).toBe("2026-12-01");
  });

  it("Jace's team members are covered by his fee until Dec 2, then must join like he does", () => {
    const member = "agent@team.test";
    const jace = ["Jljensen38@gmail.com "];
    expect(program.legacyCoverEnds(member, jace)).toEqual({ ends: new Date("2026-12-02T06:00:00Z"), viaTeam: true });
    expect(program.mustJoinProgram(member, [], DEC(1), { uplineEmails: jace, sharedPoolOnly: true })).toBe(false);
    expect(program.mustJoinProgram(member, [], DEC(2), { uplineEmails: jace, sharedPoolOnly: true })).toBe(true);
    expect(program.mustJoinProgram(member, [sub("active")], DEC(2), { uplineEmails: jace, sharedPoolOnly: true })).toBe(false);
    // Only teams on the list: David's fee doesn't cover his agents.
    expect(program.legacyCoverEnds(member, ["dclayton1235@gmail.com"])).toBeNull();
    // Their own fee wins over an upline's.
    expect(program.legacyCoverEnds("dclayton1235@gmail.com", jace)?.viaTeam).toBe(false);
    // Left the team: a shared-pool-only advertiser with no cover needs the Program right away.
    expect(program.mustJoinProgram(member, [], DEC(1), { uplineEmails: [], sharedPoolOnly: true })).toBe(true);
    expect(program.mustJoinProgram(member, [sub("canceled")], DEC(1), { uplineEmails: [], sharedPoolOnly: true })).toBe(false);
    // An advertiser with their own campaign and no fee on the list is never held back.
    expect(program.mustJoinProgram(member, [], DEC(20), { uplineEmails: [], sharedPoolOnly: false })).toBe(false);
  });
});

describe("recordProgramInvoice", () => {
  const invoice = (o: Record<string, unknown> = {}) =>
    ({
      id: "in_1",
      status: "paid",
      amount_paid: 50_000,
      status_transitions: { paid_at: 1_795_000_000 },
      parent: { subscription_details: { subscription: "sub_1", metadata: { kind: "advertiser-program", userId: "NEW" } } },
      ...o,
    }) as any;

  it("credits $400 once per invoice and makes a new member a shared-pool advertiser", async () => {
    users.NEW = { id: "NEW", isAdvertiser: false, adCampaignIds: [] };
    expect(await recordProgramInvoice(invoice())).toBe(true);
    expect(await recordProgramInvoice(invoice())).toBe(true); // webhook retry / page sync
    expect(payments).toEqual([
      expect.objectContaining({ userId: "NEW", amountCents: 40_000, method: "program", note: expect.stringContaining("program-invoice:in_1") }),
    ]);
    expect(payments[0].note).toContain("$100.00 management fee");
    expect(users.NEW).toMatchObject({ isAdvertiser: true, adCampaignIds: ["shared-pool"] });
    expect(enforceAdSpend).toHaveBeenCalledTimes(1);
  });

  it("an existing advertiser keeps their own campaigns", async () => {
    users.DAVID = { id: "DAVID", isAdvertiser: true, adCampaignIds: [] };
    const inv = invoice({ parent: { subscription_details: { subscription: "sub_2", metadata: { kind: "advertiser-program", userId: "DAVID" } } } });
    expect(await recordProgramInvoice(inv)).toBe(true);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(payments[0]).toMatchObject({ userId: "DAVID", amountCents: 40_000 });
  });

  it("reads the subscription when the invoice doesn't carry its metadata", async () => {
    users.NEW = { id: "NEW", isAdvertiser: false, adCampaignIds: [] };
    subscriptionsRetrieve.mockResolvedValue({ metadata: { kind: "advertiser-program", userId: "NEW" } });
    expect(await recordProgramInvoice(invoice({ parent: null, subscription: "sub_1" }))).toBe(true);
    expect(subscriptionsRetrieve).toHaveBeenCalledWith("sub_1");
    expect(payments).toHaveLength(1);
  });

  it("leaves other subscriptions' invoices alone", async () => {
    subscriptionsRetrieve.mockResolvedValue({ metadata: { userId: "AGENT", weeklyCents: "50000" } });
    expect(await recordProgramInvoice(invoice({ parent: null, subscription: "sub_lead" }))).toBe(false);
    expect(await recordProgramInvoice(invoice({ parent: null, subscription: undefined, lines: { data: [] } }))).toBe(false);
    expect(payments).toEqual([]);
  });

  it("an unpaid or $0 program invoice credits nothing", async () => {
    users.NEW = { id: "NEW", isAdvertiser: false, adCampaignIds: [] };
    expect(await recordProgramInvoice(invoice({ status: "open" }))).toBe(true);
    expect(await recordProgramInvoice(invoice({ amount_paid: 0 }))).toBe(true);
    expect(payments).toEqual([]);
  });

  it("the lead subscription never adopts a program subscription", async () => {
    expect(await upsertLocalSubscription({ id: "sub_1", status: "active", metadata: { kind: "advertiser-program", userId: "NEW" } } as any)).toBeNull();
    expect(db.leadSubscription.upsert).not.toHaveBeenCalled();
  });
});

describe("shared pool for members", () => {
  const summary = (o: Record<string, unknown> = {}) => ({
    errors: [], balanceCents: 40_000, costPerLeadCents: 2_000, spendCents: 0, leads: 0,
    program: { member: false, joined: false, mustJoin: false, legacyUntil: null }, ...o,
  });

  it("members pay cost per lead + 3%; others pay cost per lead", () => {
    expect(clientLeadPriceCents(2_045, summary({ program: { joined: true } }) as any)).toBe(2_106);
    expect(clientLeadPriceCents(2_045, summary() as any)).toBe(2_045);
  });

  it("skips a November fee client who must join, and prices members with the card fee", async () => {
    users.MEMBER = { id: "MEMBER", name: "Member", email: "m@new.test", licensedStates: ["TX"], ownedOrganizations: [] };
    users.LEGACY = { id: "LEGACY", name: "David", email: "dclayton1235@gmail.com", licensedStates: ["TX"], ownedOrganizations: [] };
    users.OTHER = { id: "OTHER", name: "Other", email: "o@new.test", licensedStates: ["TX"], ownedOrganizations: [] };
    getAdSpendSummary.mockImplementation(async (id: string) =>
      id === "MEMBER"
        ? summary({ program: { member: true, joined: true, mustJoin: false, legacyUntil: null } })
        : id === "LEGACY"
          ? summary({ program: { member: false, joined: false, mustJoin: true, legacyUntil: "2026-12-03T06:00:00.000Z" } })
          : summary(),
    );
    const slots = await sharedClientSlots("TX", "abca");
    expect(slots.map((s) => [s.userId, s.cplCents, !!s.program])).toEqual([
      ["MEMBER", program.programLeadPriceCents(2_045), true],
      ["OTHER", 2_045, false],
    ]);
  });

  it("a member whose balance can't cover the marked-up price waits", async () => {
    users.MEMBER = { id: "MEMBER", name: "Member", email: "m@new.test", licensedStates: [], ownedOrganizations: [] };
    getAdSpendSummary.mockResolvedValue(summary({ balanceCents: 2_050, program: { member: true, joined: true, mustJoin: false, legacyUntil: null } }));
    expect(await sharedClientSlots("TX", "abca")).toEqual([]); // $20.50 < $21.06
  });
});
