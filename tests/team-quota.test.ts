import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Weekly amounts (lib/teamQuota.ts): the split math, order fulfillment and
 * admin overflow under WEEKLY_QUOTA, and the API that sets each agent's number.
 * Mocked prisma with SYNTHETIC data only.
 */

const db: any = {
  order: { findUnique: vi.fn(), update: vi.fn() },
  lead: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  organization: { findUnique: vi.fn(), update: vi.fn() },
  membership: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), findFirst: vi.fn() },
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

import { takeQuotaSlot, type QuotaSlot } from "@/lib/teamQuota";
import { fulfillOrder } from "@/lib/fulfillment";
import { assignOverflowLeadTo, getEligibleAdminSlots } from "@/lib/house";
import { PATCH as patchMember } from "@/app/api/team/members/[id]/route";
import { PATCH as patchSettings } from "@/app/api/team/settings/route";

const slot = (userId: string, quota: number, got = 0, licensedStates: string[] = []): QuotaSlot => ({ userId, quota, got, licensedStates });

describe("takeQuotaSlot", () => {
  it("splits in proportion to each agent's weekly number", () => {
    const slots = [slot("a20", 20), slot("b100", 100)];
    const got: Record<string, number> = {};
    for (let i = 0; i < 60; i++) {
      const who = takeQuotaSlot(slots, "TX")!;
      got[who] = (got[who] ?? 0) + 1;
    }
    expect(got).toEqual({ a20: 10, b100: 50 });
  });

  it("stops at each agent's number, then keeps the rest with the owner (null)", () => {
    const slots = [slot("a", 2, 1), slot("b", 1)];
    expect([takeQuotaSlot(slots, "TX"), takeQuotaSlot(slots, "TX"), takeQuotaSlot(slots, "TX")].sort()).toEqual(
      [null, "a", "b"].sort(),
    );
  });

  it("only routes to agents licensed in the lead's state (none on file = all states)", () => {
    const slots = [slot("fl-only", 10, 0, ["FL"]), slot("anywhere", 10, 5)];
    expect(takeQuotaSlot(slots, "TX")).toBe("anywhere");
    expect(takeQuotaSlot(slots, "FL")).toBe("fl-only");
    expect(takeQuotaSlot([slot("fl-only", 10, 0, ["FL"])], "TX")).toBeNull();
  });
});

const OWNER = "owner_1";
function setupOrder(over: Record<string, unknown> = {}) {
  db.order.findUnique.mockResolvedValue({
    id: "ord_1", userId: OWNER, quantity: 5, status: "PROCESSING", packageId: "iul-fresh",
    filterStates: ["TX"], filterIncomeMin: null, filterAgeMaxDays: 2, filterAgeMinDays: 0,
    organizationId: "org_1", deliverToUserId: null, leads: [], ...over,
  });
  db.lead.findMany.mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => ({ id: `lead_${i}`, state: "TX", name: "Test Lead", phone: "", email: "" })),
  );
  db.organization.findUnique.mockResolvedValue({ ownerId: OWNER, distributionMode: "WEEKLY_QUOTA", rrCursor: 0, memberships: [] });
  db.membership.findMany.mockResolvedValue([
    { userId: "agent_a", weeklyLeadQuota: 2, user: { licensedStates: [] } },
    { userId: "agent_b", weeklyLeadQuota: 10, user: { licensedStates: ["TX"] } },
  ]);
  db.lead.groupBy.mockResolvedValue([{ assignedUserId: "agent_b", _count: { _all: 9 } }]); // b has 1 left
}
const assignedTo = () =>
  Object.fromEntries(
    db.lead.updateMany.mock.calls.map((c: any) => [c[0].data.assignedUserId, { ids: c[0].where.id.in, quota: !!c[0].data.quotaRoutedAt }]),
  );

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserId = null;
  db.$transaction.mockImplementation(async (fn: any) => fn(db));
});

describe("fulfillOrder under weekly amounts", () => {
  it("fills agents up to their number, stamps quotaRoutedAt, and the owner keeps the rest", async () => {
    setupOrder();
    expect(await fulfillOrder("ord_1")).toBe(5);
    const a = assignedTo();
    expect(a.agent_a).toEqual({ ids: expect.any(Array), quota: true });
    expect(a.agent_a.ids).toHaveLength(2);
    expect(a.agent_b.ids).toHaveLength(1);
    expect(a.agent_b.quota).toBe(true);
    expect(a[OWNER].ids).toHaveLength(2);
    expect(a[OWNER].quota).toBe(false);
    // counted only the team's quota-routed leads from the last 7 days
    expect(db.lead.groupBy.mock.calls[0][0].where).toMatchObject({ organizationId: "org_1", quotaRoutedAt: { gte: expect.any(Date) } });
  });

  it("never splits an order routed to a specific agent", async () => {
    setupOrder({ deliverToUserId: "agent_z" });
    await fulfillOrder("ord_1");
    expect(Object.keys(assignedTo())).toEqual(["agent_z"]);
    expect(db.membership.findMany).not.toHaveBeenCalled();
  });

  it("never splits a team member's own order", async () => {
    setupOrder({ userId: "agent_a" });
    await fulfillOrder("ord_1");
    expect(Object.keys(assignedTo())).toEqual(["agent_a"]);
    expect(assignedTo().agent_a.quota).toBe(false);
  });

  it("leaves MANUAL teams alone", async () => {
    setupOrder();
    db.organization.findUnique.mockResolvedValue({ ownerId: OWNER, distributionMode: "MANUAL", rrCursor: 0, memberships: [] });
    await fulfillOrder("ord_1");
    expect(Object.keys(assignedTo())).toEqual([OWNER]);
  });
});

describe("admin overflow under weekly amounts", () => {
  beforeEach(() => {
    db.lead.findUnique.mockResolvedValue({ receivedAt: new Date(), state: "TX" });
    db.lead.updateMany.mockResolvedValue({ count: 1 });
    db.organization.findUnique.mockResolvedValue({ ownerId: "admin_1", distributionMode: "WEEKLY_QUOTA" });
  });

  it("hands the overflow lead to an agent with room", async () => {
    db.membership.findMany.mockResolvedValue([{ userId: "agent_a", weeklyLeadQuota: 5, user: { licensedStates: [] } }]);
    db.lead.groupBy.mockResolvedValue([]);
    expect(await assignOverflowLeadTo("lead_9", "admin_1", "org_admin", "round-robin overflow")).toBe(true);
    expect(db.lead.updateMany.mock.calls[0][0].data).toMatchObject({ assignedUserId: "agent_a", organizationId: "org_admin", quotaRoutedAt: expect.any(Date) });
  });

  it("keeps it when every agent is full", async () => {
    db.membership.findMany.mockResolvedValue([{ userId: "agent_a", weeklyLeadQuota: 5, user: { licensedStates: [] } }]);
    db.lead.groupBy.mockResolvedValue([{ assignedUserId: "agent_a", _count: { _all: 5 } }]);
    await assignOverflowLeadTo("lead_9", "admin_1", "org_admin", "round-robin overflow");
    expect(db.lead.updateMany.mock.calls[0][0].data.assignedUserId).toBe("admin_1");
    expect(db.lead.updateMany.mock.calls[0][0].data.quotaRoutedAt).toBeUndefined();
  });

  it("counts overflow sent to the admin's agents toward the admin's own weekly target", async () => {
    db.user.findMany.mockResolvedValue([
      { id: "admin_1", weeklyLeadTarget: 10, licensedStates: [], ownedOrganizations: [{ id: "org_admin" }] },
    ]);
    db.lead.count.mockResolvedValue(10);
    expect(await getEligibleAdminSlots()).toEqual([]);
    expect(db.lead.count.mock.calls[0][0].where.OR).toEqual([
      { assignedUserId: "admin_1" },
      { organizationId: "org_admin", quotaRoutedAt: { not: null } },
    ]);
  });
});

describe("team API", () => {
  const ownerMembership = { id: "m_owner", organizationId: "org_1", userId: OWNER, role: "OWNER", goldmineBlocked: false, organization: { id: "org_1", name: "Owner's Team", distributionMode: "WEEKLY_QUOTA" } };
  beforeEach(() => {
    sessionUserId = OWNER;
    db.user.findUnique.mockResolvedValue({ defaultOrganizationId: "org_1" });
    db.membership.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? { id: where.id, organizationId: "org_1", userId: "agent_a", role: "AGENT", goldmineBlocked: false } : ownerMembership,
    );
    db.membership.update.mockImplementation(async ({ data }: any) => ({ id: "m_a", role: "AGENT", inRotation: true, goldmineBlocked: false, ...data }));
  });
  const patch = (body: unknown) =>
    patchMember(new Request("https://advertisely.io/api/team/members/m_a", { method: "PATCH", body: JSON.stringify(body) }) as any, { params: { id: "m_a" } });

  it("saves a whole-number weekly amount; 0 clears it", async () => {
    expect((await patch({ weeklyLeadQuota: 20 })).status).toBe(200);
    expect(db.membership.update.mock.calls[0][0].data).toEqual({ weeklyLeadQuota: 20 });
    await patch({ weeklyLeadQuota: 0 });
    expect(db.membership.update.mock.calls[1][0].data).toEqual({ weeklyLeadQuota: null });
  });

  it("rejects bad amounts", async () => {
    for (const bad of [1001, -1, 2.5, "lots"]) expect((await patch({ weeklyLeadQuota: bad })).status).toBe(400);
    expect(db.membership.update).not.toHaveBeenCalled();
  });

  it("agents can't set amounts", async () => {
    sessionUserId = "agent_a";
    db.membership.findUnique.mockImplementation(async ({ where }: any) =>
      where.id ? { id: "m_a", organizationId: "org_1", userId: "agent_a", role: "AGENT" } : { ...ownerMembership, role: "AGENT", userId: "agent_a" },
    );
    expect((await patch({ weeklyLeadQuota: 500 })).status).toBe(403);
  });

  it("the team can switch to weekly amounts", async () => {
    const res = await patchSettings(new Request("https://advertisely.io/api/team/settings", { method: "PATCH", body: JSON.stringify({ distributionMode: "WEEKLY_QUOTA" }) }) as any);
    expect(res.status).toBe(200);
    expect(db.organization.update.mock.calls[0][0].data).toEqual({ distributionMode: "WEEKLY_QUOTA" });
  });
});
