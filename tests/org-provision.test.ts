import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory stand-in for the three tables. $transaction runs one at a time, the
// way the per-user advisory lock serializes concurrent first page loads.
let orgs: { id: string; name: string; ownerId: string }[] = [];
let memberships: { organizationId: string; userId: string; role: string }[] = [];
let user: { id: string; name: string; email: string; agency: null; defaultOrganizationId: string | null } | null;
let lockTail: Promise<unknown> = Promise.resolve();

const tick = () => new Promise((r) => setTimeout(r, 0));
const db = {
  $executeRaw: vi.fn(async () => 0),
  user: {
    findUnique: vi.fn(async () => { await tick(); return user; }),
    update: vi.fn(async ({ data }: any) => { Object.assign(user!, data); return user; }),
  },
  organization: {
    findFirst: vi.fn(async ({ where }: any) => { await tick(); return orgs.find((o) => o.ownerId === where.ownerId) ?? null; }),
    create: vi.fn(async ({ data }: any) => {
      await tick();
      const org = { id: `org_${orgs.length + 1}`, name: data.name, ownerId: data.ownerId };
      orgs.push(org);
      return org;
    }),
  },
  membership: {
    create: vi.fn(async ({ data }: any) => { memberships.push(data); return data; }),
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async ({ where }: any) => {
      await tick();
      const m = memberships.find((x) => x.userId === where.userId);
      if (!m) return null;
      const org = orgs.find((o) => o.id === m.organizationId)!;
      return { role: m.role, goldmineBlocked: false, organization: { id: org.id, name: org.name, distributionMode: "MANUAL" } };
    }),
  },
};
const prismaMock = {
  ...db,
  $transaction: vi.fn((fn: (tx: typeof db) => Promise<unknown>) => {
    const run = lockTail.then(() => fn(db));
    lockTail = run.catch(() => undefined);
    return run;
  }),
};
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));

import { ensureOrgContext, ensureOwnedOrganization, primaryOwnedTeam } from "@/lib/org";

beforeEach(() => {
  vi.clearAllMocks();
  orgs = [];
  memberships = [];
  lockTail = Promise.resolve();
  user = { id: "u1", name: "David Layton", email: "d@example.com", agency: null, defaultOrganizationId: null };
});

describe("team provisioning", () => {
  it("makes one team when a new user's first page load fires parallel calls", async () => {
    const results = await Promise.all([ensureOrgContext("u1"), ensureOrgContext("u1"), ensureOwnedOrganization("u1"), ensureOrgContext("u1")]);
    expect(orgs).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(user!.defaultOrganizationId).toBe("org_1");
    expect(results[0]).toMatchObject({ organizationId: "org_1", role: "OWNER", organizationName: "David's Team" });
    expect(results[3]).toMatchObject({ organizationId: "org_1" });
  });

  it("locks before it checks for an existing team", async () => {
    await ensureOrgContext("u1");
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.organization.findFirst.mock.invocationCallOrder[0]);
  });

  it("keeps the active team of someone who signed up into another team", async () => {
    user!.defaultOrganizationId = "upline_team";
    const org = await ensureOwnedOrganization("u1");
    expect(org).toMatchObject({ id: "org_1" });
    expect(user!.defaultOrganizationId).toBe("upline_team");
  });

  it("returns null for a user that doesn't exist", async () => {
    user = null;
    expect(await ensureOrgContext("u1")).toBeNull();
    expect(orgs).toHaveLength(0);
  });
});

describe("primaryOwnedTeam", () => {
  const owned = [{ id: "empty_dupe" }, { id: "real_team" }];

  it("uses the active team when they own it, not the oldest", () => {
    expect(primaryOwnedTeam(owned, "real_team")).toEqual({ id: "real_team" });
  });

  it("falls back to the oldest when their active team is someone else's", () => {
    expect(primaryOwnedTeam(owned, "upline_team")).toEqual({ id: "empty_dupe" });
    expect(primaryOwnedTeam(owned, null)).toEqual({ id: "empty_dupe" });
  });

  it("is undefined when they own no team", () => {
    expect(primaryOwnedTeam([], "upline_team")).toBeUndefined();
  });
});
