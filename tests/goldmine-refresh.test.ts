import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Goldmine live refresh: GET /api/leads?pipeline=goldmine&since=… returns only the
 * changed leads plus the ids still on the board, and mergeLeadDelta folds that into
 * the viewer's board. Mocked prisma and session with SYNTHETIC data.
 */

const prismaMock = { lead: { findMany: vi.fn() } };
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));
const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const ensureOrgContext = vi.fn();
vi.mock("@/lib/org", () => ({
  ensureOrgContext: (...a: unknown[]) => ensureOrgContext(...a),
  canManageTeam: () => false,
}));
vi.mock("@/lib/goldmine", () => ({ sweepGoldmineForOrg: vi.fn().mockResolvedValue(0) }));
vi.mock("@/lib/serialize", () => ({ serializeLead: (l: { id: string }) => ({ id: l.id }) }));

import { GET } from "@/app/api/leads/route";
import { mergeLeadDelta, changedLeadIds } from "@/lib/pipelineSync";
import type { Lead } from "@/types";

type Req = Parameters<typeof GET>[0];
const get = async (qs: string) => {
  const res = await GET(new Request(`https://x/api/leads?${qs}`) as unknown as Req);
  return res.json();
};

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: "agent", role: "AGENT" } });
  ensureOrgContext.mockResolvedValue({ organizationId: "org1", role: "AGENT", goldmineOff: false });
});

describe("GET /api/leads?pipeline=goldmine&since", () => {
  it("full load returns every lead and an asOf to refresh from", async () => {
    prismaMock.lead.findMany.mockResolvedValue([{ id: "a" }, { id: "b" }]);
    const d = await get("pipeline=goldmine");
    expect(d.leads).toEqual([{ id: "a" }, { id: "b" }]);
    expect(d.ids).toBeUndefined();
    expect(Date.parse(d.asOf)).toBeGreaterThan(0);
  });

  it("with since, returns only changed leads plus the ids still in Goldmine", async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: "b" }]) // changed
      .mockResolvedValueOnce([{ id: "a" }, { id: "b" }]); // ids
    const since = new Date(Date.now() - 10_000).toISOString();
    const d = await get(`pipeline=goldmine&since=${encodeURIComponent(since)}`);
    expect(d.leads).toEqual([{ id: "b" }]);
    expect(d.ids).toEqual(["a", "b"]);

    const where = prismaMock.lead.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ organizationId: "org1", pipeline: "goldmine", trashedAt: null });
    // Looks back a little before since, and counts new dials/notes as changes.
    const gt = where.OR[0].updatedAt.gt as Date;
    expect(gt.getTime()).toBeLessThan(Date.parse(since));
    expect(where.OR.map((o: object) => Object.keys(o)[0])).toEqual(["updatedAt", "activity", "notes", "tasks"]);
  });

  it("ignores since that is unreadable or too old (full load instead)", async () => {
    prismaMock.lead.findMany.mockResolvedValue([{ id: "a" }]);
    for (const since of ["nope", new Date(Date.now() - 7 * 3600_000).toISOString()]) {
      const d = await get(`pipeline=goldmine&since=${encodeURIComponent(since)}`);
      expect(d.ids).toBeUndefined();
    }
    expect(prismaMock.lead.findMany).toHaveBeenCalledTimes(2);
  });

  it("the main CRM board refreshes the same way, limited to the agent's own leads", async () => {
    prismaMock.lead.findMany
      .mockResolvedValueOnce([{ id: "new" }]) // changed (a lead that just dripped in)
      .mockResolvedValueOnce([{ id: "mine" }, { id: "new" }]); // ids
    const d = await get(`since=${encodeURIComponent(new Date(Date.now() - 15_000).toISOString())}`);
    expect(d.leads).toEqual([{ id: "new" }]);
    expect(d.ids).toEqual(["mine", "new"]);
    const where = prismaMock.lead.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ assignedUserId: "agent", pipeline: "main", trashedAt: null });
    expect(where.OR).toBeDefined();
  });

  it("a member with Goldmine switched off still gets nothing", async () => {
    ensureOrgContext.mockResolvedValue({ organizationId: "org1", role: "AGENT", goldmineOff: true });
    const d = await get(`pipeline=goldmine&since=${encodeURIComponent(new Date().toISOString())}`);
    expect(d.leads).toEqual([]);
    expect(prismaMock.lead.findMany).not.toHaveBeenCalled();
  });
});

const lead = (id: string, o: Partial<Lead> = {}) =>
  ({ id, receivedAt: `2026-11-0${id.charCodeAt(0) - 96}T00:00:00Z`, pipelineStage: "new-lead", ...o }) as Lead;

describe("mergeLeadDelta", () => {
  const NOW = 1_000_000;
  const none = new Map<string, number>();

  it("replaces changed leads, adds new ones, drops ones that left, newest first", () => {
    const cur = [lead("a"), lead("b"), lead("c")];
    const m = mergeLeadDelta(cur, [lead("b", { pipelineStage: "dialed" }), lead("d")], ["a", "b", "d"], none, NOW, 15_000);
    expect(m.leads.map((l) => l.id)).toEqual(["d", "b", "a"]);
    expect(m.leads.find((l) => l.id === "b")?.pipelineStage).toBe("dialed");
    expect(m.leads.find((l) => l.id === "a")).toBe(cur[0]);
    expect(m.missing).toBe(false);
  });

  it("keeps the viewer's own recent change instead of the server's older copy", () => {
    const mine = lead("b", { pipelineStage: "contacted" });
    const touched = new Map([["b", NOW - 2_000]]);
    const m = mergeLeadDelta([lead("a"), mine], [lead("b", { pipelineStage: "new-lead" })], ["a", "b"], touched, NOW, 15_000);
    expect(m.leads.find((l) => l.id === "b")).toBe(mine);
  });

  it("after the grace period the server's copy wins again", () => {
    const touched = new Map([["b", NOW - 20_000]]);
    const m = mergeLeadDelta([lead("b", { pipelineStage: "contacted" })], [lead("b", { pipelineStage: "dialed" })], ["b"], touched, NOW, 15_000);
    expect(m.leads[0].pipelineStage).toBe("dialed");
  });

  it("a lead the viewer just removed isn't put back, and isn't reported missing", () => {
    const touched = new Map([["b", NOW - 1_000]]);
    const m = mergeLeadDelta([lead("a")], [lead("b")], ["a", "b"], touched, NOW, 15_000);
    expect(m.leads.map((l) => l.id)).toEqual(["a"]);
    expect(m.missing).toBe(false);
  });

  it("flags a lead the server lists that the board has no copy of", () => {
    const m = mergeLeadDelta([lead("a")], [], ["a", "b"], none, NOW, 15_000);
    expect(m.missing).toBe(true);
  });
});

describe("changedLeadIds", () => {
  it("finds edited, added and removed cards", () => {
    const a = lead("a"), b = lead("b"), c = lead("c");
    expect(changedLeadIds([a, b, c], [a, { ...b }, lead("d")]).sort()).toEqual(["b", "c", "d"]);
    expect(changedLeadIds([a, b], [a, b])).toEqual([]);
  });
});
