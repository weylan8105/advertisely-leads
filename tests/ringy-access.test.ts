import { describe, it, expect, beforeEach, vi } from "vitest";

const { db, state } = vi.hoisted(() => {
  const state = {
    ringy: new Map<string, { enabled: boolean; config: any }>(),
    // userId -> { organizationId, role } of their active team
    ctx: new Map<string, { organizationId: string; role: "OWNER" | "ADMIN" | "AGENT" }>(),
    members: [] as { organizationId: string; userId: string; role: string }[],
  };
  const db: any = {
    integration: {
      findUnique: async ({ where }: any) => state.ringy.get(where.userId_type.userId) ?? null,
    },
    membership: {
      findFirst: async ({ where }: any) =>
        state.members.find((m) => m.organizationId === where.organizationId && m.userId === where.userId) ?? null,
    },
  };
  return { db, state };
});

vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
vi.mock("@/lib/org", () => ({
  ensureOrgContext: async (userId: string) => state.ctx.get(userId) ?? null,
  canManageTeam: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import { canLinkRingyFor, hasRingy } from "@/lib/ringyAccess";

const KEYS = { sid: "s".repeat(32), authToken: "t".repeat(32) };

beforeEach(() => {
  state.ringy = new Map([["upline", { enabled: true, config: KEYS }]]);
  state.ctx = new Map([
    ["upline", { organizationId: "team", role: "OWNER" }],
    ["helper", { organizationId: "team", role: "ADMIN" }],
    ["agent", { organizationId: "team", role: "AGENT" }],
    ["other", { organizationId: "other-team", role: "OWNER" }],
  ]);
  state.members = [
    { organizationId: "team", userId: "upline", role: "OWNER" },
    { organizationId: "team", userId: "helper", role: "ADMIN" },
    { organizationId: "team", userId: "agent", role: "AGENT" },
    { organizationId: "other-team", userId: "other", role: "OWNER" },
    { organizationId: "other-team", userId: "stranger", role: "AGENT" },
  ];
});

describe("linking Ringy for downlines", () => {
  it("lets an upline with Ringy link it for their downlines", async () => {
    expect(await canLinkRingyFor("upline", "agent")).toBe(true);
    expect(await canLinkRingyFor("upline", "helper")).toBe(true);
  });

  it("needs the upline's own Ringy connected and enabled", async () => {
    state.ringy.set("upline", { enabled: false, config: KEYS });
    expect(await canLinkRingyFor("upline", "agent")).toBe(false);
    state.ringy.set("upline", { enabled: true, config: { sid: "x" } });
    expect(await canLinkRingyFor("upline", "agent")).toBe(false);
    state.ringy.delete("upline");
    expect(await hasRingy("upline")).toBe(false);
  });

  it("works for any team manager who has Ringy, not just one person", async () => {
    state.ringy.set("helper", { enabled: true, config: KEYS });
    expect(await canLinkRingyFor("helper", "agent")).toBe(true);
    // An agent with Ringy doesn't manage the team.
    state.ringy.set("agent", { enabled: true, config: KEYS });
    expect(await canLinkRingyFor("agent", "helper")).toBe(false);
  });

  it("never reaches the team owner, themselves, or people on other teams", async () => {
    state.ringy.set("helper", { enabled: true, config: KEYS });
    expect(await canLinkRingyFor("helper", "upline")).toBe(false);
    expect(await canLinkRingyFor("upline", "upline")).toBe(false);
    expect(await canLinkRingyFor("upline", "stranger")).toBe(false);
    expect(await canLinkRingyFor("upline", "nobody")).toBe(false);
  });
});
