import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Lead destination (lib/leadDestination.ts): the owner's pipeline, a round robin
 * with the team Goldmine, or Goldmine only, for order fulfillment, admin
 * overflow and the dashboard setting. Mocked prisma with SYNTHETIC data only.
 */

const db: any = {
  order: { findUnique: vi.fn(), update: vi.fn() },
  lead: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  organization: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  membership: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  leadActivity: { create: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: false, sendLeadDeliveryEmail: vi.fn() }));
vi.mock("@/lib/sheets", () => ({ isSheetsConfigured: false, appendRows: vi.fn() }));
vi.mock("@/lib/replacement", () => ({ tryReplacementForFreshLead: vi.fn(async () => false) }));
let sessionUserId: string | null = null;
vi.mock("next-auth", () => ({ getServerSession: async () => (sessionUserId ? { user: { id: sessionUserId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { pipelinesFor, planLeadPipelines } from "@/lib/leadDestination";
import { fulfillOrder } from "@/lib/fulfillment";
import { assignOverflowLeadTo, getEligibleAdminSlots, slotLicensedStates } from "@/lib/house";
import { PATCH as patchMember } from "@/app/api/team/members/[id]/route";
import { PATCH as patchDestination } from "@/app/api/team/lead-destination/route";
import { weeklyPaidIn } from "@/lib/memberAdSpend";

const OWNER = "owner_1";
let cursor = 0;
function team(leadDestination: string, workers = 2) {
  db.organization.findUnique.mockResolvedValue({ ownerId: OWNER, leadDestination });
  db.membership.count.mockResolvedValue(workers);
  db.organization.update.mockImplementation(async ({ data }: any) => {
    cursor += data.rrCursor?.increment ?? 0;
    return { rrCursor: cursor };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  cursor = 0;
  sessionUserId = null;
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
});

describe("pipelinesFor", () => {
  it("alternates for SPLIT, picking up where the last lead left off", () => {
    expect(pipelinesFor("SPLIT", 0, 4)).toEqual(["main", "goldmine", "main", "goldmine"]);
    expect(pipelinesFor("SPLIT", 1, 2)).toEqual(["goldmine", "main"]);
    expect(pipelinesFor("GOLDMINE", 7, 2)).toEqual(["goldmine", "goldmine"]);
    expect(pipelinesFor("PERSONAL", 0, 2)).toEqual(["main", "main"]);
  });
});

describe("planLeadPipelines", () => {
  it("keeps the round robin going across separate leads", async () => {
    team("SPLIT");
    const got = [];
    for (let i = 0; i < 4; i++) got.push(...(await planLeadPipelines("org_1", OWNER)));
    expect(got).toEqual(["main", "goldmine", "main", "goldmine"]);
  });

  it("keeps everything personal with nobody else to work the Goldmine", async () => {
    team("GOLDMINE", 0);
    expect(await planLeadPipelines("org_1", OWNER, 2)).toEqual(["main", "main"]);
    expect(db.membership.count.mock.calls[0][0].where).toEqual({ organizationId: "org_1", userId: { not: OWNER }, goldmineBlocked: false });
  });

  it("only applies to the team's own owner", async () => {
    team("GOLDMINE");
    expect(await planLeadPipelines("org_1", "someone_else")).toEqual(["main"]);
    expect(await planLeadPipelines(null, OWNER)).toEqual(["main"]);
  });
});

function setupOrder(over: Record<string, unknown> = {}) {
  db.order.findUnique.mockResolvedValue({
    id: "ord_1", userId: OWNER, quantity: 4, status: "PROCESSING", packageId: "iul-fresh",
    filterStates: ["TX"], filterIncomeMin: null, filterAgeMaxDays: 2, filterAgeMinDays: 0,
    organizationId: "org_1", deliverToUserId: null, leads: [], ...over,
  });
  db.lead.findMany.mockResolvedValue(
    Array.from({ length: 4 }, (_, i) => ({ id: `lead_${i}`, state: "TX", name: "Test Lead", phone: "", email: "" })),
  );
}
const updates = () => db.lead.updateMany.mock.calls.map((c: any) => c[0]);

describe("fulfillOrder", () => {
  it("splits the owner's own order between their pipeline and the team Goldmine", async () => {
    setupOrder();
    team("SPLIT");
    expect(await fulfillOrder("ord_1")).toBe(4);
    const [main, gold] = updates();
    expect(main.where.id.in).toEqual(["lead_0", "lead_2"]);
    expect(main.data).toMatchObject({ assignedUserId: OWNER, orderId: "ord_1", organizationId: "org_1" });
    expect(main.data.pipeline).toBeUndefined();
    expect(gold.where.id.in).toEqual(["lead_1", "lead_3"]);
    expect(gold.data).toMatchObject({ assignedUserId: OWNER, pipeline: "goldmine", pipelineStage: "new-lead", organizationId: "org_1" });
  });

  it("never sends an order bought for a downline to the Goldmine", async () => {
    setupOrder({ deliverToUserId: "agent_z" });
    team("GOLDMINE");
    await fulfillOrder("ord_1");
    expect(updates()).toHaveLength(1);
    expect(updates()[0].data.assignedUserId).toBe("agent_z");
    expect(updates()[0].data.pipeline).toBeUndefined();
  });

  it("a team member's own order stays in their pipeline", async () => {
    setupOrder({ userId: "agent_a" });
    team("GOLDMINE");
    await fulfillOrder("ord_1");
    expect(updates().map((u: any) => [u.data.assignedUserId, u.data.pipeline])).toEqual([["agent_a", undefined]]);
  });

  it("fills an order with shared Enhanced Wealth page leads, never Essential Workers or nurse page leads", async () => {
    setupOrder();
    team("PERSONAL");
    const lead = (id: string, over: Record<string, unknown>) => ({ id, state: "TX", name: "Test Lead", phone: "", email: "", ...over });
    db.lead.findMany.mockResolvedValue([
      lead("ew", { source: "facebook", packageId: "blue-collar-iul" }),
      lead("ewws", { source: "facebook", packageId: "blue-collar-iul", campaignName: "EWWS - Blue Collar" }),
      lead("nurse", { source: "facebook", packageId: "healthcare-iul", campaignName: "EWWS - Nurses" }),
      lead("quiz", { source: "early-retirement-quiz", packageId: "blue-collar-iul" }),
    ]);
    expect(await fulfillOrder("ord_1")).toBe(2);
    expect(updates()[0].where.id.in.sort()).toEqual(["ew", "quiz"]);
  });
});

describe("admin overflow", () => {
  beforeEach(() => {
    db.lead.findUnique.mockResolvedValue({ receivedAt: new Date(), state: "TX" });
    db.lead.updateMany.mockResolvedValue({ count: 1 });
  });

  it("puts the lead in the admin's team Goldmine on a Goldmine turn", async () => {
    team("GOLDMINE");
    db.organization.findUnique.mockResolvedValue({ ownerId: "admin_1", leadDestination: "GOLDMINE" });
    expect(await assignOverflowLeadTo("lead_9", "admin_1", "org_admin", "round-robin overflow")).toBe(true);
    expect(updates()[0].data).toMatchObject({ assignedUserId: "admin_1", pipeline: "goldmine", organizationId: "org_admin" });
  });

  it("keeps it in the admin's pipeline otherwise", async () => {
    db.organization.findUnique.mockResolvedValue({ ownerId: "admin_1", leadDestination: "PERSONAL" });
    await assignOverflowLeadTo("lead_9", "admin_1", "org_admin", "round-robin overflow");
    expect(updates()[0].data.assignedUserId).toBe("admin_1");
    expect(updates()[0].data.pipeline).toBeUndefined();
  });

  it("an admin's slot covers only the states the admin picked; the team gets the upline's states", async () => {
    expect(slotLicensedStates(["AR", "TX", "AR"]).sort()).toEqual(["AR", "TX"]);
    expect(slotLicensedStates([])).toEqual([]); // none on file = everywhere
    db.user.findMany.mockResolvedValue([
      {
        id: "admin_1", weeklyLeadTarget: 10, licensedStates: ["AR"], leadTypes: ["healthcare-iul"],
        ownedOrganizations: [{ id: "org_admin", memberships: [{ user: { licensedStates: ["TX"] } }, { user: { licensedStates: ["AR", "GA"] } }] }],
      },
    ]);
    db.lead.count.mockResolvedValue(0);
    const [s] = await getEligibleAdminSlots();
    expect(s.licensedStates).toEqual(["AR"]);
  });
});

describe("team API", () => {
  const ownerMembership = { id: "m_owner", organizationId: "org_1", userId: OWNER, role: "OWNER", goldmineBlocked: false, organization: { id: "org_1", name: "Owner's Team", leadDestination: "PERSONAL" } };
  beforeEach(() => {
    sessionUserId = OWNER;
    db.user.findUnique.mockResolvedValue({
      defaultOrganizationId: "org_1",
      isAdvertiser: true,
      ownedOrganizations: [{ id: "org_1", name: "Owner's Team", leadDestination: "PERSONAL", goldmineEnabled: false, memberships: [{ goldmineBlocked: false }] }],
    });
    db.membership.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? { id: where.id, organizationId: "org_1", userId: "agent_a", role: "AGENT", goldmineBlocked: false } : ownerMembership,
    );
    db.membership.update.mockImplementation(async ({ data }: any) => ({ id: "m_a", role: "AGENT", goldmineBlocked: false, ...data }));
  });
  const patch = (body: unknown) =>
    patchMember(new Request("https://advertisely.io/api/team/members/m_a", { method: "PATCH", body: JSON.stringify(body) }) as any, { params: { id: "m_a" } });
  const setDestination = (destination: unknown) =>
    patchDestination(new Request("https://advertisely.io/api/team/lead-destination", { method: "PATCH", body: JSON.stringify({ destination }) }) as any);

  it("switches a member's Goldmine access off and on", async () => {
    expect((await patch({ goldmineAccess: false })).status).toBe(200);
    expect(db.membership.update.mock.calls[0][0].data).toEqual({ goldmineBlocked: true });
    await patch({ goldmineAccess: true });
    expect(db.membership.update.mock.calls[1][0].data).toEqual({ goldmineBlocked: false });
  });

  it("no longer takes weekly amounts", async () => {
    expect((await patch({ weeklyLeadQuota: 20 })).status).toBe(400);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("agents can't change Goldmine access", async () => {
    sessionUserId = "agent_a";
    db.membership.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? { id: "m_a", organizationId: "org_1", userId: "agent_a", role: "AGENT" } : { ...ownerMembership, role: "AGENT", userId: "agent_a" },
    );
    expect((await patch({ goldmineAccess: false })).status).toBe(403);
  });

  it("the owner picks the round robin with Goldmine, which turns the Goldmine on", async () => {
    expect((await setDestination("SPLIT")).status).toBe(200);
    expect(db.organization.updateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ["org_1"] } }, data: { leadDestination: "SPLIT" } });
    expect(db.organization.updateMany.mock.calls[1][0]).toEqual({ where: { id: { in: ["org_1"] } }, data: { goldmineEnabled: true } });
  });

  it("refuses Goldmine options with nobody to work them, and bad values", async () => {
    db.user.findUnique.mockResolvedValue({
      defaultOrganizationId: "org_1", isAdvertiser: true,
      ownedOrganizations: [{ id: "org_1", name: "Solo", leadDestination: "PERSONAL", goldmineEnabled: false, memberships: [{ goldmineBlocked: true }] }],
    });
    expect((await setDestination("GOLDMINE")).status).toBe(400);
    expect((await setDestination("WEEKLY_QUOTA")).status).toBe(400);
    expect((await setDestination("PERSONAL")).status).toBe(200);
  });
});

describe("member ad spend", () => {
  it("adds up what they paid in over 7 days and averages 4 weeks", () => {
    const now = Date.parse("2026-11-18T12:00:00Z");
    const at = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
    const pay = (daysAgo: number, amountCents: number, method = "card", description: string | null = null) =>
      ({ id: `p${daysAgo}${method}`, at: at(daysAgo), amountCents, method, description, processingFeeCents: 0 });
    expect(
      weeklyPaidIn(
        {
          payments: [pay(2, 50_000), pay(10, 30_000, "zelle"), pay(3, 99_999, "other"), pay(1, -42_000, "team-fee"), pay(40, 70_000)],
          otherStripePayments: [pay(5, 20_000, "card", "Team campaign funding: Upline"), pay(4, 9_900, "card", "Advertiser Program")],
        } as any,
        now,
      ),
    ).toEqual({ last7Cents: 70_000, avgWeekCents: 25_000 });
  });
});
