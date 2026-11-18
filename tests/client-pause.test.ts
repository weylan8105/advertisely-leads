import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * CLIENT_PAUSES (lib/clientPause.ts): a client inside a dated pause window gets
 * no new leads. Mocked prisma with SYNTHETIC data only.
 */

const db: any = {
  order: { findUnique: vi.fn(), update: vi.fn() },
  lead: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  organization: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  leadActivity: { create: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(db)),
};
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: false, sendLeadDeliveryEmail: vi.fn() }));
vi.mock("@/lib/sheets", () => ({ isSheetsConfigured: false, appendRows: vi.fn() }));
vi.mock("@/lib/replacement", () => ({ tryReplacementForFreshLead: vi.fn(async () => false) }));

import { CLIENT_PAUSES, isClientPaused } from "@/lib/clientPause";
import { fulfillOrder } from "@/lib/fulfillment";

const LUKE = "cmu1muk4m0000jp043c27hqht";
const at = (iso: string) => new Date(iso);

describe("Luke Scheffers: paused Nov 20 through Nov 27 (Central)", () => {
  it("is on the list", () => {
    expect(CLIENT_PAUSES.some((p) => p.userId === LUKE)).toBe(true);
  });

  it("starts at midnight Central on Nov 20, not before", () => {
    expect(isClientPaused(LUKE, at("2026-11-20T05:59:59Z"))).toBe(false); // 11:59 PM Nov 19 Central
    expect(isClientPaused(LUKE, at("2026-11-20T06:00:00Z"))).toBe(true); // 12:00 AM Nov 20 Central
  });

  it("covers all of Nov 27 and ends at midnight Central on Nov 28", () => {
    expect(isClientPaused(LUKE, at("2026-11-24T18:00:00Z"))).toBe(true);
    expect(isClientPaused(LUKE, at("2026-11-28T05:59:59Z"))).toBe(true); // 11:59 PM Nov 27 Central
    expect(isClientPaused(LUKE, at("2026-11-28T06:00:00Z"))).toBe(false); // 12:00 AM Nov 28 Central
  });

  it("pauses nobody else", () => {
    expect(isClientPaused("someone_else", at("2026-11-24T18:00:00Z"))).toBe(false);
    expect(isClientPaused(null, at("2026-11-24T18:00:00Z"))).toBe(false);
  });
});

describe("fulfillOrder for a paused client", () => {
  const order = (userId: string, over: Record<string, unknown> = {}) => ({
    id: "ord_1", userId, quantity: 50, status: "DELIVERING", packageId: "iul-fresh",
    filterStates: ["TX"], filterIncomeMin: null, filterAgeMaxDays: 2, filterAgeMinDays: 0,
    organizationId: "org_1", deliverToUserId: null, leads: [], ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    db.$transaction.mockImplementation(async (fn: any) => fn(db));
    db.lead.findMany.mockResolvedValue([{ id: "lead_1", state: "TX", name: "Test Lead", phone: "", email: "", source: "early-retirement-quiz", rawFormData: {} }]);
    db.organization.findUnique.mockResolvedValue({ ownerId: "nobody", distributionMode: "MANUAL", rrCursor: 0, memberships: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("delivers nothing during the pause and leaves the order open", async () => {
    vi.setSystemTime(at("2026-11-23T15:00:00Z"));
    db.order.findUnique.mockResolvedValue(order(LUKE));
    expect(await fulfillOrder("ord_1")).toBe(0);
    expect(db.lead.findMany).not.toHaveBeenCalled();
    expect(db.lead.updateMany).not.toHaveBeenCalled();
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it("also holds an order someone else bought that is routed to the paused client", async () => {
    vi.setSystemTime(at("2026-11-23T15:00:00Z"));
    db.order.findUnique.mockResolvedValue(order("upline_1", { deliverToUserId: LUKE }));
    expect(await fulfillOrder("ord_1")).toBe(0);
    expect(db.lead.updateMany).not.toHaveBeenCalled();
  });

  it("delivers as usual before the pause and again after it", async () => {
    for (const when of ["2026-11-19T15:00:00Z", "2026-11-28T15:00:00Z"]) {
      vi.clearAllMocks();
      db.$transaction.mockImplementation(async (fn: any) => fn(db));
      db.lead.findMany.mockResolvedValue([{ id: "lead_1", state: "TX", name: "Test Lead", phone: "", email: "", source: "early-retirement-quiz", rawFormData: {} }]);
      db.organization.findUnique.mockResolvedValue({ ownerId: "nobody", distributionMode: "MANUAL", rrCursor: 0, memberships: [] });
      vi.setSystemTime(at(when));
      db.order.findUnique.mockResolvedValue(order(LUKE));
      expect(await fulfillOrder("ord_1")).toBe(1);
      expect(db.lead.updateMany.mock.calls[0][0].data.assignedUserId).toBe(LUKE);
    }
  });

  it("does not hold another client's order during Luke's pause", async () => {
    vi.setSystemTime(at("2026-11-23T15:00:00Z"));
    db.order.findUnique.mockResolvedValue(order("other_client"));
    expect(await fulfillOrder("ord_1")).toBe(1);
  });
});
