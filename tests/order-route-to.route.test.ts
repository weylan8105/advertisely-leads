import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/orders/:id/route-to — an upline sends an order's leads to a
 * downline agent. SYNTHETIC data only.
 */

const ORDER = { id: "ord1", userId: "jordan", organizationId: "davids-team", packageId: "iul-fresh" };
let members: Set<string>; // "orgId:userId"
const db = {
  order: { findUnique: vi.fn(async () => ORDER), update: vi.fn(async () => ({})) },
  membership: {
    findUnique: vi.fn(async ({ where }: any) => {
      const k = where.organizationId_userId;
      return members.has(`${k.organizationId}:${k.userId}`) ? { id: "m" } : null;
    }),
  },
  user: { findUnique: vi.fn(async () => ({ name: "Trevor Test", email: "trevor@example.test" })) },
  lead: { findMany: vi.fn(async () => [{ id: "L1", name: "A", phone: "1", email: "", state: "TX", occupation: null, age: null, income: null, intentReason: null }]), updateMany: vi.fn(async () => ({ count: 1 })) },
  leadActivity: { createMany: vi.fn(async () => ({})) },
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
let sessionUserId = "jordan";
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: sessionUserId, name: "Jordan Test", role: "AGENT" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: false, sendLeadDeliveryEmail: vi.fn() }));
let ctx: any;
vi.mock("@/lib/org", () => ({
  ensureOrgContext: async () => ctx,
  canManageTeam: (r: string) => r === "OWNER" || r === "ADMIN",
}));

import { POST } from "@/app/api/orders/[id]/route-to/route";

const call = (userId: string | null) =>
  POST(new Request("https://advertisely.io/api/orders/ord1/route-to", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId }) }) as any, { params: { id: "ord1" } });

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserId = "jordan";
  members = new Set(["davids-team:david", "davids-team:jordan", "jordans-team:jordan", "jordans-team:trevor"]);
  ctx = { organizationId: "jordans-team", role: "OWNER" };
});

describe("POST /api/orders/:id/route-to", () => {
  it("a buyer whose order is filed under their old upline's team can send it to an agent on the team they run", async () => {
    const res = await call("trevor");
    expect(res.status).toBe(200);
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: "ord1" }, data: { deliverToUserId: "trevor", organizationId: "jordans-team" } });
    expect(db.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ assignedUserId: "trevor", organizationId: "jordans-team" }) }),
    );
  });

  it("an agent on the order's own team routes without moving the order", async () => {
    members.add("davids-team:trevor");
    ctx = { organizationId: "davids-team", role: "AGENT" };
    expect((await call("trevor")).status).toBe(200);
    expect(db.order.update).toHaveBeenCalledWith({ where: { id: "ord1" }, data: { deliverToUserId: "trevor" } });
  });

  it("still refuses someone on neither team", async () => {
    const res = await call("stranger");
    expect(res.status).toBe(400);
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("only the buyer gets the team-they-run allowance, not another manager", async () => {
    sessionUserId = "someone-else";
    ctx = { organizationId: "jordans-team", role: "OWNER" };
    expect((await call("trevor")).status).toBe(403);
  });
});
