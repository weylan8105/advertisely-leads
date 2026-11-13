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

import { formAnswer, forwardLeadToRingy } from "@/lib/ringy";
import { canManageRingyOf } from "@/lib/ringyAccess";

describe("managing someone's Ringy", () => {
  it("allows yourself, site admins, and uplines with Ringy", async () => {
    expect(await canManageRingyOf("agent", "agent")).toBe(true);
    expect(await canManageRingyOf("stranger", "agent", "ADMIN")).toBe(true);
    expect(await canManageRingyOf("upline", "agent")).toBe(true);
    expect(await canManageRingyOf("stranger", "agent")).toBe(false);
    expect(await canManageRingyOf("agent", "upline")).toBe(false);
  });
});

describe("Ringy monthly_budget / retire_by", () => {
  it("reads quiz and Meta form answers, ignoring case and underscores", () => {
    expect(formAnswer({ monthlyBudget: "$500_–_$1,000" }, ["monthlyBudget"])).toBe("$500 – $1,000");
    expect(formAnswer({ "Desired Retirement Age": "", retirement_timeline: "by_55" }, ["Desired Retirement Age", "retirementTimeline"])).toBe("by 55");
    expect(formAnswer({ "when_would_you_ideally_like_to_retire?": "60" }, ["When would you ideally like to retire?"])).toBe("60");
    expect(formAnswer(null, ["monthlyBudget"])).toBe("");
  });
});

describe("Ringy payload field names", () => {
  it("posts Ringy's documented keys, incl. retire_by and monthly_budget", async () => {
    let body: any = null;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ vendorResponseId: "x" }), { status: 200 });
    }) as any;
    try {
      const r = await forwardLeadToRingy(
        { name: "A", phone: "1", email: "e", state: "TX", age: 40, occupation: "o", income: 1, rawFormData: { monthlyBudget: "300", retirementTimeline: "by_60" } } as any,
        { sid: "s", authToken: "t" },
      );
      expect(r.ok).toBe(true);
    } finally {
      globalThis.fetch = orig;
    }
    expect(Object.keys(body).sort()).toEqual(
      ["age", "authToken", "email", "full_name", "income", "monthly_budget", "occupation", "phone_number", "retire_by", "sid", "state"],
    );
    expect(body.monthly_budget).toBe("300");
    expect(body.retire_by).toBe("by 60");
  });
});
