import { describe, it, expect, vi, beforeEach } from "vitest";

// Admins switch an advertiser's lead types from Client accounts.

const db = vi.hoisted(() => ({
  role: "ADMIN",
  users: {} as Record<string, { id: string; isAdvertiser: boolean; leadTypes: string[] }>,
  updates: [] as any[],
}));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { role: db.role } })) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        const u = db.users[where.id];
        return u ? { id: u.id, isAdvertiser: u.isAdvertiser } : null;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        db.updates.push({ id: where.id, ...data });
        db.users[where.id].leadTypes = data.leadTypes;
        return db.users[where.id];
      }),
    },
  },
}));

import { POST } from "../app/api/admin/accounts/lead-types/route";

const post = (body: unknown) =>
  POST(new Request("https://x.test/api/admin/accounts/lead-types", { method: "POST", body: JSON.stringify(body) }) as any);

beforeEach(() => {
  db.role = "ADMIN";
  db.updates = [];
  db.users = {
    adv: { id: "adv", isAdvertiser: true, leadTypes: [] },
    agent: { id: "agent", isAdvertiser: false, leadTypes: [] },
  };
});

describe("POST /api/admin/accounts/lead-types", () => {
  it("is admin only", async () => {
    db.role = "AGENT";
    expect((await post({ userId: "adv", leadTypes: ["healthcare-iul"] })).status).toBe(403);
    expect(db.updates).toEqual([]);
  });

  it("turns Nurse on and keeps Blue Collar on", async () => {
    const res = await post({ userId: "adv", leadTypes: ["blue-collar-iul", "healthcare-iul"] });
    expect(res.status).toBe(200);
    expect((await res.json()).leadTypes).toEqual(["blue-collar-iul", "healthcare-iul"]);
    expect(db.users.adv.leadTypes).toEqual(["healthcare-iul"]);
  });

  it("turns Blue Collar off (stored as an opt-out)", async () => {
    const res = await post({ userId: "adv", leadTypes: ["healthcare-iul"] });
    expect((await res.json()).leadTypes).toEqual(["healthcare-iul"]);
    expect(db.users.adv.leadTypes).toEqual(["-blue-collar-iul", "healthcare-iul"]);
  });

  it("ignores unknown ids", async () => {
    const res = await post({ userId: "adv", leadTypes: ["blue-collar-iul", "made-up"] });
    expect((await res.json()).leadTypes).toEqual(["blue-collar-iul"]);
    expect(db.users.adv.leadTypes).toEqual([]);
  });

  it("refuses non-advertisers, missing users and bad bodies", async () => {
    expect((await post({ userId: "agent", leadTypes: ["healthcare-iul"] })).status).toBe(400);
    expect((await post({ userId: "nobody", leadTypes: [] })).status).toBe(404);
    expect((await post({ userId: "adv" })).status).toBe(400);
    expect((await post({ leadTypes: [] })).status).toBe(400);
    expect(db.updates).toEqual([]);
  });
});
