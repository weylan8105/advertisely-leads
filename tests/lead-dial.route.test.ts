import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for POST /api/leads/:id/dial — mocked prisma and session with SYNTHETIC
 * data. Never touches a real DB/production.
 */

const prismaMock = {
  lead: { findUnique: vi.fn() },
  leadActivity: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));
const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const canActOnLead = vi.fn();
vi.mock("@/lib/leadAccess", () => ({ canActOnLead: (...a: unknown[]) => canActOnLead(...a) }));

import { POST } from "@/app/api/leads/[id]/dial/route";
import { reportDial } from "@/lib/dials";

type Req = Parameters<typeof POST>[0];
const send = async (via: unknown) => {
  const res = await POST({ json: async () => ({ via }) } as unknown as Req, { params: { id: "L1" } });
  return { status: res.status, body: await res.json() };
};
const ago = (ms: number) => new Date(Date.now() - ms);
// This agent's earlier dials on the lead, newest first: earlier(["copy", 5_000], ...)
const earlier = (...dials: [string, number][]) =>
  prismaMock.leadActivity.findMany.mockResolvedValue(
    dials.map(([via, ms], i) => ({ id: `A${i + 1}`, createdAt: ago(ms), metadata: { via, actorId: "agent" } })),
  );

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: "agent", name: "Sam Agent", role: "AGENT" } });
  canActOnLead.mockResolvedValue(true);
  prismaMock.lead.findUnique.mockResolvedValue({ id: "L1", assignedUserId: "agent", organizationId: "o1", pipeline: "main" });
  prismaMock.leadActivity.findMany.mockResolvedValue([]);
});

describe("reportDial", () => {
  const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).via);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("sends a copy made right after clicking the lead", async () => {
    reportDial("quick", "talking");
    reportDial("quick", "copy");
    await flush();
    expect(sent()).toEqual(["talking", "copy"]);
  });

  it("sends every copy, one at a time per lead", async () => {
    let answer!: () => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise((r) => { answer = () => r({ ok: true } as Response); }));
    reportDial("twice", "copy");
    reportDial("twice", "copy");
    reportDial("other", "copy");
    await flush();
    // The second copy waits for the first answer; another lead doesn't.
    expect(sent()).toEqual(["copy", "copy"]);
    answer();
    await flush();
    expect(sent()).toEqual(["copy", "copy", "copy"]);
  });
});

describe("POST /api/leads/:id/dial", () => {
  it("logs a dial with who made it and how", async () => {
    const { body } = await send("copy");
    expect(body).toEqual({ ok: true, counted: true });
    expect(prismaMock.leadActivity.create.mock.calls[0][0].data).toMatchObject({
      leadId: "L1", type: "CALL_MADE", author: "Sam Agent", metadata: { via: "copy", actorId: "agent" },
    });
  });

  it("counts copying the number twice as two dials", async () => {
    earlier(["copy", 5_000]);
    expect((await send("copy")).body.counted).toBe(true);
    expect(prismaMock.leadActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.leadActivity.findMany.mock.calls[0][0]).toMatchObject({ take: 2, orderBy: { createdAt: "desc" } });
  });

  it("stops at two dials when the number is copied a third time within 2 minutes", async () => {
    earlier(["copy", 20_000], ["copy", 100_000]);
    expect((await send("copy")).body.counted).toBe(false);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
  });

  it("counts Call toward the same two", async () => {
    earlier(["copy", 20_000], ["call", 60_000]);
    expect((await send("call")).body.counted).toBe(false);
    earlier(["call", 20_000]);
    expect((await send("copy")).body.counted).toBe(true);
  });

  it("counts again once the 2 minutes have passed", async () => {
    earlier(["copy", 30_000], ["copy", 130_000]);
    expect((await send("copy")).body.counted).toBe(true);
  });

  it("treats clicking the lead then copying its number as one dial", async () => {
    earlier(["talking", 120_000]);
    expect((await send("copy")).body.counted).toBe(false);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
    const { where, data } = prismaMock.leadActivity.update.mock.calls[0][0];
    expect(where).toEqual({ id: "A1" });
    expect(data.metadata).toEqual({ via: "copy", actorId: "agent" });
    // Dated at the copy, so the 2-minute window starts there.
    expect(Date.now() - data.createdAt.getTime()).toBeLessThan(1_000);
  });

  it("counts click, copy, copy as two dials", async () => {
    earlier(["copy", 15_000]); // the click, taken over by the first copy
    expect((await send("copy")).body.counted).toBe(true);
  });

  it("doesn't count clicking the lead again during the same call", async () => {
    earlier(["copy", 10 * 60_000]);
    expect((await send("talking")).body.counted).toBe(false);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
    expect(prismaMock.leadActivity.update).not.toHaveBeenCalled();
  });

  it("doesn't count an admin looking through a client's lead", async () => {
    getServerSession.mockResolvedValue({ user: { id: "boss", role: "ADMIN" } });
    canActOnLead.mockResolvedValue(false);
    expect((await send("copy")).body.counted).toBe(false);
    expect(canActOnLead.mock.calls[0][1]).toBe(false);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
  });

  it("counts an upline's copy but not their click on a downline's card", async () => {
    getServerSession.mockResolvedValue({ user: { id: "upline", role: "AGENT" } });
    expect((await send("talking")).body.counted).toBe(false);
    expect((await send("copy")).body.counted).toBe(true);
  });

  it("counts a teammate's click on a Goldmine lead", async () => {
    getServerSession.mockResolvedValue({ user: { id: "teammate", role: "AGENT" } });
    prismaMock.lead.findUnique.mockResolvedValue({ id: "L1", assignedUserId: "agent", organizationId: "o1", pipeline: "goldmine" });
    expect((await send("talking")).body.counted).toBe(true);
  });

  it("rejects an unknown action and a signed-out caller", async () => {
    expect((await send("email")).status).toBe(400);
    getServerSession.mockResolvedValue(null);
    expect((await send("copy")).status).toBe(401);
  });

  it("404s on a lead that doesn't exist", async () => {
    prismaMock.lead.findUnique.mockResolvedValue(null);
    expect((await send("copy")).status).toBe(404);
  });
});
