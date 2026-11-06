import { describe, it, expect, vi, beforeEach } from "vitest";

// Resends Enhanced Wealth events at their real times, once each.

const db = vi.hoisted(() => ({ sends: [] as any[], moves: [] as any[], leads: [] as any[], role: "ADMIN" }));
const fired = vi.hoisted(() => ({ stage: vi.fn(async () => {}), lead: vi.fn(async () => ({ ok: true })) }));

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { role: db.role } })) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: {
    funnelEvent: { findMany: vi.fn(async () => db.sends) },
    leadActivity: { findMany: vi.fn(async () => db.moves) },
    lead: { findMany: vi.fn(async () => db.leads) },
  },
}));
vi.mock("@/lib/metaCapi", () => ({
  INSTANT_FORM_LEAD_EVENT: "Contact",
  STAGE_EVENTS: { approved: { event: "CompleteRegistration" }, "issued-not-paid": { event: "AddPaymentInfo" } },
  fireMetaStageEvent: fired.stage,
  fireMetaLeadEvent: fired.lead,
}));

import { POST } from "../app/api/admin/meta-resend/route";

const movedAt = new Date("2026-11-03T20:04:00Z");
const receivedAt = new Date("2026-11-02T10:00:00Z");

beforeEach(() => {
  db.sends = [];
  db.moves = [];
  db.leads = [];
  db.role = "ADMIN";
  fired.stage.mockClear();
  fired.lead.mockClear();
});

describe("POST /api/admin/meta-resend", () => {
  it("is admin only", async () => {
    db.role = "USER";
    expect((await POST()).status).toBe(403);
  });

  it("resends stage moves and leads at their real times", async () => {
    db.moves = [{ leadId: "L1", body: 'Moved to "Approved" in the pipeline.', createdAt: movedAt }];
    db.leads = [{ id: "L2", receivedAt }];
    const res = await POST();
    expect(await res.json()).toEqual({ processed: 2, remaining: 0 });
    expect(fired.stage).toHaveBeenCalledWith("L1", "approved", null, movedAt);
    expect(fired.lead).toHaveBeenCalledWith(db.leads[0], receivedAt);
  });

  it("skips anything already sent under the current name", async () => {
    db.sends = [
      { cta: "ok AddPaymentInfo rcvd:1 id:found lead:L1" },
      { cta: "ok Contact rcvd:1 id:found lead:L2" },
    ];
    db.moves = [{ leadId: "L1", body: 'Moved to "Issued Not Paid" in the pipeline.', createdAt: movedAt }];
    db.leads = [{ id: "L2", receivedAt }];
    const res = await POST();
    expect(await res.json()).toEqual({ processed: 0, remaining: 0 });
    expect(fired.stage).not.toHaveBeenCalled();
    expect(fired.lead).not.toHaveBeenCalled();
  });

  it("still sends a lead whose earlier send used the old name", async () => {
    db.sends = [{ cta: "ok InstantFormLead rcvd:1 id:found lead:L2" }];
    db.leads = [{ id: "L2", receivedAt }];
    await POST();
    expect(fired.lead).toHaveBeenCalledTimes(1);
  });
});
