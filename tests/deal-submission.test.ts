import { describe, it, expect, vi, beforeEach } from "vitest";

// Stage moves into Underwriting or later need the AP; the first one is the deal's submission.
const { state, db } = vi.hoisted(() => {
  const state = {
    lead: { id: "L1", assignedUserId: "agent", organizationId: null, pipeline: "main", pipelineStage: "presentation-ran", valueCents: null as number | null },
    priorConversionMoves: 0,
    updates: [] as any[],
    activities: [] as any[],
  };
  const db: any = {
    lead: {
      findUnique: vi.fn(async () => ({ ...state.lead })),
      update: vi.fn(async ({ data }: any) => {
        state.updates.push(data);
        Object.assign(state.lead, data);
        return state.lead;
      }),
    },
    user: { findUnique: vi.fn(async () => ({ pipelineStages: null })) },
    leadActivity: {
      count: vi.fn(async () => state.priorConversionMoves),
      create: vi.fn(async ({ data }: any) => {
        state.activities.push(data);
        return data;
      }),
    },
  };
  return { state, db };
});

vi.mock("@/lib/prisma", () => ({ prisma: db, isDatabaseConfigured: true }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "agent", name: "Sam Agent", role: "AGENT" } })) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/leadAccess", () => ({ canActOnLead: vi.fn(async () => true) }));
vi.mock("@/lib/metaCapi", () => ({ fireMetaStageEvent: vi.fn(async () => {}), fireMetaContactedEvent: vi.fn(async () => {}), isPickupStage: () => false }));

const move = async (body: Record<string, unknown>) => {
  const { PATCH } = await import("@/app/api/leads/[id]/stage/route");
  const req = new Request("http://x/api/leads/L1/stage", { method: "PATCH", body: JSON.stringify(body) });
  const res = await PATCH(req as any, { params: { id: "L1" } });
  return { status: res.status, json: await res.json() };
};

beforeEach(() => {
  state.lead.pipelineStage = "presentation-ran";
  state.lead.valueCents = null;
  state.priorConversionMoves = 0;
  state.updates = [];
  state.activities = [];
});

describe("deal stages need the AP", () => {
  it("refuses Underwriting without an AP", async () => {
    const r = await move({ stage: "underwriting" });
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/annual premium/i);
    expect(state.updates).toEqual([]);
  });

  it("refuses a zero AP", async () => {
    expect((await move({ stage: "approved", premiumCents: 0 })).status).toBe(400);
  });

  it("saves the AP as the lead value and flags the first submission", async () => {
    const r = await move({ stage: "underwriting", premiumCents: 360_000 });
    expect(r.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ pipelineStage: "underwriting", valueCents: 360_000, soldPremiumCents: null });
    expect(state.activities[0].metadata).toMatchObject({ stage: "underwriting", apCents: 360_000, submitted: true, actorId: "agent" });
  });

  it("moving a submitted deal along keeps it one deal", async () => {
    state.lead.pipelineStage = "underwriting";
    await move({ stage: "approved", premiumCents: 360_000 });
    expect(state.activities[0].metadata.submitted).toBeUndefined();
  });

  it("a deal that was submitted before and moved back isn't announced again", async () => {
    state.priorConversionMoves = 1;
    await move({ stage: "underwriting", premiumCents: 100_000 });
    expect(state.activities[0].metadata.submitted).toBeUndefined();
  });

  it("Issued PAID logs the AP for P&L too", async () => {
    state.lead.pipelineStage = "issued-not-paid";
    await move({ stage: "issued-paid", premiumCents: 250_000 });
    expect(state.updates[0]).toMatchObject({ valueCents: 250_000, soldPremiumCents: 250_000 });
  });

  it("other stages don't need an AP and leave the value alone", async () => {
    const r = await move({ stage: "call-back" });
    expect(r.status).toBe(200);
    expect(state.updates[0]).not.toHaveProperty("valueCents");
  });
});

describe("shortName", () => {
  it("shows first name and last initial", async () => {
    const { shortName } = await import("@/lib/dealAlerts");
    expect(shortName("Jace Lee Jensen")).toBe("Jace J.");
    expect(shortName("Kyle")).toBe("Kyle");
    expect(shortName("  ")).toBe("An agent");
  });
});
