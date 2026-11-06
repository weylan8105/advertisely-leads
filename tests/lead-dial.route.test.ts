import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for POST /api/leads/:id/dial — mocked prisma and session with SYNTHETIC
 * data. Never touches a real DB/production.
 */

const prismaMock = {
  lead: { findUnique: vi.fn() },
  leadActivity: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
const earlier = (via: string, ms: number) =>
  prismaMock.leadActivity.findFirst.mockResolvedValue({ id: "A1", createdAt: ago(ms), metadata: { via, actorId: "agent" } });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { id: "agent", name: "Sam Agent", role: "AGENT" } });
  canActOnLead.mockResolvedValue(true);
  prismaMock.lead.findUnique.mockResolvedValue({ id: "L1", assignedUserId: "agent", organizationId: "o1", pipeline: "main" });
  prismaMock.leadActivity.findFirst.mockResolvedValue(null);
});

describe("reportDial", () => {
  const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)).via);
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  });

  it("sends a copy made right after clicking the lead", () => {
    reportDial("quick", "talking");
    reportDial("quick", "copy");
    expect(sent()).toEqual(["talking", "copy"]);
  });

  it("sends a double click once", () => {
    reportDial("double", "copy");
    reportDial("double", "copy");
    expect(sent()).toEqual(["copy"]);
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

  it("counts a copy after 30 seconds as a redial", async () => {
    earlier("copy", 45_000);
    expect((await send("copy")).body.counted).toBe(true);
    expect(prismaMock.leadActivity.create).toHaveBeenCalledTimes(1);
  });

  it("ignores a double click on copy", async () => {
    earlier("copy", 5_000);
    expect((await send("copy")).body.counted).toBe(false);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
  });

  it("treats clicking the lead then copying its number as one dial", async () => {
    earlier("talking", 120_000);
    expect((await send("copy")).body.counted).toBe(false);
    expect(prismaMock.leadActivity.create).not.toHaveBeenCalled();
    expect(prismaMock.leadActivity.update.mock.calls[0][0]).toMatchObject({
      where: { id: "A1" }, data: { metadata: { via: "copy", actorId: "agent" } },
    });
  });

  it("doesn't count clicking the lead again during the same call", async () => {
    earlier("copy", 10 * 60_000);
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
