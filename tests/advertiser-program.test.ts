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
  membership: { count: vi.fn(async ({ where }: any) => (where.userId === "EW_AGENT" && where.organizationId.in.includes("cmsdc9be50001l4045uljpthc") ? 1 : 0)) },
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));

const subscriptionsRetrieve = vi.fn();
const subscriptionsCreate = vi.fn();
const subscriptionsUpdate = vi.fn(async () => ({}));
const subscriptionsCancel = vi.fn(async () => ({}));
const couponsRetrieve = vi.fn();
const couponsCreate = vi.fn(async () => ({}));
vi.mock("@/lib/stripe", () => ({
  isStripeConfigured: true,
  stripe: {
    subscriptions: {
      retrieve: (...a: unknown[]) => subscriptionsRetrieve(...a),
      create: (...a: unknown[]) => subscriptionsCreate(...a),
      update: (...a: unknown[]) => subscriptionsUpdate(...a),
      cancel: (...a: unknown[]) => subscriptionsCancel(...a),
    },
    coupons: { retrieve: (...a: unknown[]) => couponsRetrieve(...a), create: (...a: unknown[]) => couponsCreate(...a) },
    prices: { list: vi.fn(async () => ({ data: [{ id: "price_program" }] })) },
  },
}));

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
const { recordProgramInvoice, joinWithFeeWaived, waiveExistingMembership, isOnFeeWaiverTeam, getFeeWaiverCouponId } = await import(
  "@/lib/advertiserProgramBilling"
);
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
  it("$500 every 2 weeks is the membership; a lead costs our cost + 20% management + 3% card fee", () => {
    expect(program.ADVERTISER_PROGRAM.amountCents).toBe(50_000);
    expect(program.programLeadPriceCents(2_500)).toBe(3_090); // $25.00 → $30.90
    expect(program.programLeadPriceCents(3_228)).toBe(3_990);
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
    expect(program.mustJoinProgram(david, [sub("canceled")], DEC(20))).toBe(true); // membership ended: leads stop
    expect(program.mustJoinProgram(david, [sub("canceled")], DEC(2))).toBe(false); // still inside his November month
    expect(program.mustJoinProgram("someone@new.test", [sub("canceled")], DEC(20))).toBe(true); // a lapsed member waits
    expect(program.mustJoinProgram("someone@new.test", [sub("past_due")], DEC(20))).toBe(false); // payment being retried
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
    expect(program.mustJoinProgram(member, [sub("active")], DEC(1), { uplineEmails: [], sharedPoolOnly: true })).toBe(false);
    // An advertiser with their own campaign and no fee on the list is never held back.
    expect(program.mustJoinProgram(member, [], DEC(20), { uplineEmails: [], sharedPoolOnly: false })).toBe(false);
  });
});

describe("one-time promo code", () => {
  const LUKE = "cmu1muk4m0000jp043c27hqht";
  it("gives the named account 28 free days, however the code is typed", () => {
    expect(program.programPromo("LUKE1000", LUKE, [])).toEqual({ ok: true, code: "LUKE1000", freeDays: 28 });
    expect(program.programPromo(" luke-1000 ", LUKE, [])).toMatchObject({ ok: true, freeDays: 28 });
    // A checkout they started and never finished doesn't use the code up.
    expect(program.programPromo("LUKE1000", LUKE, [{ program: true, status: "incomplete_expired" }])).toMatchObject({ ok: true });
  });
  it("is refused on any other account and for unknown codes", () => {
    expect(program.programPromo("LUKE1000", "someone-else", [])).toMatchObject({ ok: false });
    expect(program.programPromo("FREE", LUKE, [])).toMatchObject({ ok: false });
    expect(program.programPromo("", LUKE, [])).toMatchObject({ ok: false });
  });
  it("works once: refused after they have been in the program", () => {
    for (const status of ["trialing", "active", "canceled"]) {
      expect(program.programPromo("LUKE1000", LUKE, [{ program: true, status }])).toEqual({ ok: false, error: "That promo code has already been used." });
    }
  });
});

describe("David's promo code (paid $3,000 up front)", () => {
  const DAVID = "cmw2i7yr40000jp071hed4rll";
  it("gives his account 4 weeks free and $15,000 of spend without the management fee", () => {
    expect(program.programPromo("david3000", DAVID, [])).toEqual({ ok: true, code: "DAVID3000", freeDays: 28 });
    expect(program.promoNoManagementFeeCents("DAVID3000", DAVID)).toBe(1_500_000);
    expect(program.programPromo("DAVID3000", "someone-else", [])).toMatchObject({ ok: false });
    expect(program.promoNoManagementFeeCents("DAVID3000", "someone-else")).toBe(0);
    expect(program.promoNoManagementFeeCents("LUKE1000", "cmu1muk4m0000jp043c27hqht")).toBe(0);
    expect(program.promoNoManagementFeeCents(undefined, DAVID)).toBe(0);
  });
  it("without the management fee a member pays cost per lead + the 3% card fee", () => {
    expect(program.programLeadPriceCents(2_500, { noManagementFee: true })).toBe(2_575);
    expect(clientLeadPriceCents(2_045, { program: { member: true, noManagementFee: true } })).toBe(2_106);
    expect(clientLeadPriceCents(2_045, { program: { member: true, noManagementFee: false } })).toBe(2_528);
    // Not a member (his November cover): cost per lead, as before.
    expect(clientLeadPriceCents(2_045, { program: { member: false, noManagementFee: true } })).toBe(2_045);
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

  it("the $500 is the membership only: nothing goes to ad spend, and a new member becomes a shared-pool advertiser", async () => {
    users.NEW = { id: "NEW", isAdvertiser: false, adCampaignIds: [] };
    expect(await recordProgramInvoice(invoice())).toBe(true);
    expect(await recordProgramInvoice(invoice())).toBe(true); // webhook retry / page sync
    expect(payments).toEqual([]);
    expect(users.NEW).toMatchObject({ isAdvertiser: true, adCampaignIds: ["shared-pool"] });
    expect(enforceAdSpend).toHaveBeenCalled();
  });

  it("an existing advertiser keeps their own campaigns", async () => {
    users.DAVID = { id: "DAVID", isAdvertiser: true, adCampaignIds: [] };
    const inv = invoice({ parent: { subscription_details: { subscription: "sub_2", metadata: { kind: "advertiser-program", userId: "DAVID" } } } });
    expect(await recordProgramInvoice(inv)).toBe(true);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(payments).toEqual([]);
  });

  it("reads the subscription when the invoice doesn't carry its metadata", async () => {
    users.NEW = { id: "NEW", isAdvertiser: false, adCampaignIds: [] };
    subscriptionsRetrieve.mockResolvedValue({ metadata: { kind: "advertiser-program", userId: "NEW" } });
    expect(await recordProgramInvoice(invoice({ parent: null, subscription: "sub_1" }))).toBe(true);
    expect(subscriptionsRetrieve).toHaveBeenCalledWith("sub_1");
    expect(users.NEW.isAdvertiser).toBe(true);
  });

  it("leaves other subscriptions' invoices alone", async () => {
    subscriptionsRetrieve.mockResolvedValue({ metadata: { userId: "AGENT", weeklyCents: "50000" } });
    expect(await recordProgramInvoice(invoice({ parent: null, subscription: "sub_lead" }))).toBe(false);
    expect(await recordProgramInvoice(invoice({ parent: null, subscription: undefined, lines: { data: [] } }))).toBe(false);
    expect(payments).toEqual([]);
  });

  it("an unpaid or $0 program invoice doesn't enroll anyone", async () => {
    users.NEW = { id: "NEW", isAdvertiser: false, adCampaignIds: [] };
    expect(await recordProgramInvoice(invoice({ status: "open" }))).toBe(true);
    expect(await recordProgramInvoice(invoice({ amount_paid: 0 }))).toBe(true);
    expect(payments).toEqual([]);
    expect(users.NEW.isAdvertiser).toBe(false);
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

  it("members pay cost per lead + 20% + 3%; others pay cost per lead", () => {
    expect(clientLeadPriceCents(2_045, summary({ program: { member: true } }) as any)).toBe(2_528);
    expect(clientLeadPriceCents(2_045, summary({ program: { member: false, joined: true } }) as any)).toBe(2_045);
    expect(clientLeadPriceCents(2_045, summary() as any)).toBe(2_045);
  });

  it("skips a November fee client who must join, and prices members with the management and card fees", async () => {
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
    getAdSpendSummary.mockResolvedValue(summary({ balanceCents: 2_500, program: { member: true, joined: true, mustJoin: false, legacyUntil: null } }));
    expect(await sharedClientSlots("TX", "abca")).toEqual([]); // $25.00 < $25.28
  });

  it("a member whose membership has ended gets no leads, even with ad spend left", async () => {
    users.MEMBER = { id: "MEMBER", name: "Member", email: "m@new.test", licensedStates: [], ownedOrganizations: [] };
    getAdSpendSummary.mockResolvedValue(summary({ balanceCents: 90_000, program: { member: false, joined: true, mustJoin: true, legacyUntil: null } }));
    expect(await sharedClientSlots("TX", "abca")).toEqual([]);
  });
});

describe("Enhanced Wealth team: membership fee waived", () => {
  const EW = "cmsdc9be50001l4045uljpthc"; // Ryan's Team
  const waived = (status: string) => ({ program: true, status, feeWaived: true });

  it("only the Enhanced Wealth team gets the waiver", () => {
    expect(program.onFeeWaiverTeam([EW])).toBe(true);
    expect(program.onFeeWaiverTeam(["some-other-team", EW])).toBe(true);
    expect(program.onFeeWaiverTeam(["some-other-team"])).toBe(false);
    expect(program.onFeeWaiverTeam([])).toBe(false);
    expect(program.onFeeWaiverTeam([null, undefined])).toBe(false);
  });

  it("a waived membership counts like a paid one while they're on the team", () => {
    expect(program.isProgramMember([waived("active")], { onWaiverTeam: true })).toBe(true);
    // Not checked: never cut someone's leads on a check that wasn't made.
    expect(program.isProgramMember([waived("active")])).toBe(true);
    expect(program.mustJoinProgram("agent@ew.test", [waived("active")], DEC(20), { onWaiverTeam: true, sharedPoolOnly: true })).toBe(false);
    expect(program.waiverEnded([waived("active")], { onWaiverTeam: true })).toBe(false);
  });

  it("left the team: the waived membership stops counting and they join at the regular price", () => {
    expect(program.isProgramMember([waived("active")], { onWaiverTeam: false })).toBe(false);
    expect(program.mustJoinProgram("agent@ew.test", [waived("active")], DEC(20), { onWaiverTeam: false, sharedPoolOnly: true })).toBe(true);
    expect(program.waiverEnded([waived("active")], { onWaiverTeam: false })).toBe(true);
    // A paid membership is never affected by the team check.
    expect(program.isProgramMember([sub("active")], { onWaiverTeam: false })).toBe(true);
    expect(program.waiverEnded([waived("active"), sub("active")], { onWaiverTeam: false })).toBe(false);
  });

  it("savings: one $500 fee for each 2-week period started since the waiver began", () => {
    const start = new Date("2026-11-16T18:00:00Z");
    expect(program.waivedSavingsCents(start, new Date("2026-11-16T18:00:01Z"))).toBe(50_000);
    expect(program.waivedSavingsCents(start, new Date("2026-11-29T18:00:00Z"))).toBe(50_000);
    expect(program.waivedSavingsCents(start, new Date("2026-11-30T18:00:00Z"))).toBe(100_000);
    expect(program.waivedSavingsCents(start, new Date("2027-01-11T18:00:00Z"))).toBe(250_000);
    expect(program.waivedSavingsCents(start, new Date("2026-11-15T18:00:00Z"))).toBe(0); // starts later (an existing member's next period)
    expect(program.waivedSavingsCents(null)).toBe(0);
  });

  it("team membership is read from the database", async () => {
    expect(await isOnFeeWaiverTeam("EW_AGENT")).toBe(true);
    expect(await isOnFeeWaiverTeam("SOMEONE_ELSE")).toBe(false);
  });

  it("joining waived: the same membership price with a forever 100%-off coupon, marked waived, no checkout", async () => {
    couponsRetrieve.mockRejectedValueOnce(Object.assign(new Error("No such coupon"), { code: "resource_missing" }));
    subscriptionsCreate.mockResolvedValueOnce({ id: "sub_w", status: "active" });
    const s = await joinWithFeeWaived("EW_AGENT", "cus_1");
    expect(s.id).toBe("sub_w");
    expect(couponsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ id: "advertiser-program-enhanced-wealth", percent_off: 100, duration: "forever" }),
    );
    const [params, opts] = subscriptionsCreate.mock.calls[0] as any[];
    expect(params.customer).toBe("cus_1");
    expect(params.items).toEqual([{ price: "price_program" }]);
    expect(params.discounts).toEqual([{ coupon: "advertiser-program-enhanced-wealth" }]);
    expect(params.metadata).toMatchObject({ kind: "advertiser-program", userId: "EW_AGENT", feeWaived: "enhanced-wealth" });
    expect(typeof params.metadata.feeWaivedAt).toBe("string");
    expect(opts.idempotencyKey).toMatch(/^program-waived:EW_AGENT:/);
  });

  it("an existing coupon is reused", async () => {
    couponsRetrieve.mockResolvedValueOnce({ id: "advertiser-program-enhanced-wealth" });
    expect(await getFeeWaiverCouponId()).toBe("advertiser-program-enhanced-wealth");
    expect(couponsCreate).not.toHaveBeenCalled();
  });

  it("a waived join Stripe doesn't start is canceled and reported, not left behind", async () => {
    couponsRetrieve.mockResolvedValueOnce({ id: "advertiser-program-enhanced-wealth" });
    subscriptionsCreate.mockResolvedValueOnce({ id: "sub_bad", status: "incomplete" });
    await expect(joinWithFeeWaived("EW_AGENT", "cus_1")).rejects.toThrow(/incomplete/);
    expect(subscriptionsCancel).toHaveBeenCalledWith("sub_bad");
  });

  it("a paying member on the team is waived from their next payment on", async () => {
    couponsRetrieve.mockResolvedValueOnce({ id: "advertiser-program-enhanced-wealth" });
    const end = Math.floor(new Date("2026-11-30T18:00:00Z").getTime() / 1000);
    await waiveExistingMembership({ id: "sub_paid", metadata: { kind: "advertiser-program", userId: "EW_AGENT" }, items: { data: [{ current_period_end: end }] } } as any);
    const [id, params] = subscriptionsUpdate.mock.calls[0] as any[];
    expect(id).toBe("sub_paid");
    expect(params.discounts).toEqual([{ coupon: "advertiser-program-enhanced-wealth" }]);
    expect(params.metadata).toMatchObject({ feeWaived: "enhanced-wealth", feeWaivedAt: "2026-11-30T18:00:00.000Z", userId: "EW_AGENT" });
    // Already waived: nothing to do.
    subscriptionsUpdate.mockClear();
    await waiveExistingMembership({ id: "sub_w", metadata: { feeWaived: "enhanced-wealth" } } as any);
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it("a $0 waived invoice doesn't touch ad spend", async () => {
    users.EW_AGENT = { id: "EW_AGENT", isAdvertiser: true, adCampaignIds: ["shared-pool"] };
    const inv = {
      id: "in_w",
      status: "paid",
      amount_paid: 0,
      parent: { subscription_details: { subscription: "sub_w", metadata: { kind: "advertiser-program", userId: "EW_AGENT", feeWaived: "enhanced-wealth" } } },
    } as any;
    expect(await recordProgramInvoice(inv)).toBe(true); // the program's, so the lead subscription leaves it alone
    expect(payments).toHaveLength(0);
  });
});
