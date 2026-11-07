import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Handing your own leads to an agent on the team you run, when those leads are
 * filed under a team you used to be an agent on. SYNTHETIC data only.
 */

type L = { id: string; organizationId: string; assignedUserId: string | null; pipeline: string; state: string; receivedAt: Date; name: string; packageId: string };
let leads: L[];
let members: Set<string>;
const db = {
  lead: {
    findUnique: vi.fn(async ({ where }: any) => leads.find((l) => l.id === where.id) ?? null),
    findMany: vi.fn(async ({ where }: any) => leads.filter((l) => where.id.in.includes(l.id))),
    update: vi.fn(async ({ where, data }: any) => Object.assign(leads.find((l) => l.id === where.id)!, data)),
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const l of leads) if (where.id.in.includes(l.id)) { Object.assign(l, data); count++; }
      return { count };
    }),
  },
  membership: {
    findUnique: vi.fn(async ({ where }: any) => {
      const k = where.organizationId_userId;
      return members.has(`${k.organizationId}:${k.userId}`) ? { id: "m" } : null;
    }),
  },
  user: { findUnique: vi.fn(async () => ({ name: "Trevor Test" })) },
  leadActivity: { create: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
  $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
let sessionUserId = "jordan";
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { id: sessionUserId, name: "Jordan Test", role: "AGENT" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/org", () => ({
  ensureOrgContext: async () => ({ organizationId: "jordans-team", role: "OWNER" }),
  canManageTeam: (r: string) => r === "OWNER" || r === "ADMIN",
}));
vi.mock("@/lib/leadMatch", () => ({
  leadMatchesActiveOrder: async () => ({ ok: true }),
  activeOrdersFor: async () => [],
  leadMatchesOrders: () => ({ ok: true }),
}));

import { POST as assignOne } from "@/app/api/leads/[id]/assign/route";
import { POST as assignBulk } from "@/app/api/leads/assign-bulk/route";

const req = (body: unknown) =>
  new Request("https://advertisely.io/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as any;
const lead = (id: string, organizationId: string, assignedUserId: string | null, pipeline = "main"): L =>
  ({ id, organizationId, assignedUserId, pipeline, state: "TX", receivedAt: new Date(), name: "Lead", packageId: "iul-fresh" });

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserId = "jordan";
  members = new Set(["jordans-team:jordan", "jordans-team:trevor", "davids-team:david", "davids-team:jordan"]);
  leads = [
    lead("mine", "davids-team", "jordan"),
    lead("davids", "davids-team", "david"),
    lead("gold", "davids-team", "jordan", "goldmine"),
    lead("team", "jordans-team", "jordan"),
  ];
});

describe("POST /api/leads/:id/assign", () => {
  it("hands your own lead from your old upline's team to your agent, and moves it to your team", async () => {
    const res = await assignOne(req({ userId: "trevor" }), { params: { id: "mine" } });
    expect(res.status).toBe(200);
    expect(leads[0]).toMatchObject({ assignedUserId: "trevor", organizationId: "jordans-team" });
  });

  it("still refuses someone else's lead on that team, a Goldmine lead, or unassigning", async () => {
    expect((await assignOne(req({ userId: "trevor" }), { params: { id: "davids" } })).status).toBe(403);
    expect((await assignOne(req({ userId: "trevor" }), { params: { id: "gold" } })).status).toBe(403);
    expect((await assignOne(req({ userId: null }), { params: { id: "mine" } })).status).toBe(403);
    expect(leads[1].assignedUserId).toBe("david");
  });
});

describe("POST /api/leads/assign-bulk", () => {
  it("moves your own leads (refiled to your team) and team leads, skips the rest", async () => {
    const res = await assignBulk(req({ leadIds: ["mine", "davids", "gold", "team"], userId: "trevor" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ count: 2, skippedNotYours: 2 });
    expect(leads.map((l) => [l.id, l.assignedUserId, l.organizationId])).toEqual([
      ["mine", "trevor", "jordans-team"],
      ["davids", "david", "davids-team"],
      ["gold", "jordan", "davids-team"],
      ["team", "trevor", "jordans-team"],
    ]);
  });
});
