import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Nov 16 ABCA page test (live page "LP" vs /qualify "IF"): the beacon keeps the
 * tags, and the admin funnel reports them as the current test's A and B arms.
 * Mocked prisma with SYNTHETIC rows. Never touches a real DB.
 */

const prismaMock = {
  funnelEvent: { create: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: async () => ({ user: { role: "ADMIN" } }) }));
vi.mock("@/lib/metaInsights", () => ({ getAbcaAdInsights: async () => ({ configured: false, linkClicks: 0, landingPageViews: 0 }) }));

import { NextRequest } from "next/server";
import { POST as track } from "@/app/api/track/route";
import { GET as funnel } from "@/app/api/admin/funnel/route";

const fb = (n: number) => `IwAR${String(n).padStart(4, "0")}${"x".repeat(60)}`;
type Row = { sessionId: string; fbclid: string | null; variant: string | null; t: Date; v: boolean; c: boolean; steps: number[] | null; cta1: string | null };
function row(i: number, variant: string | null, steps: number[], c = false): Row {
  return { sessionId: `s${i}`, fbclid: fb(i), variant, t: new Date("2026-11-16T20:00:00Z"), v: true, c, steps, cta1: "hero_tap" };
}

describe("page test beacons", () => {
  beforeEach(() => prismaMock.funnelEvent.create.mockReset());
  for (const variant of ["LP", "IF", "A", "B"]) {
    it(`stores variant ${variant}`, async () => {
      await track(new NextRequest("http://x/api/track", { method: "POST", body: JSON.stringify({ sessionId: "s_abc123", type: "view", variant }) }));
      expect(prismaMock.funnelEvent.create.mock.calls[0][0].data.variant).toBe(variant);
    });
  }
  it("drops QA visits' tag", async () => {
    await track(new NextRequest("http://x/api/track", { method: "POST", body: JSON.stringify({ sessionId: "s_abc123", type: "view", variant: "QA" }) }));
    expect(prismaMock.funnelEvent.create.mock.calls[0][0].data.variant).toBeNull();
  });
});

describe("funnel dashboard during the page test", () => {
  // Old hero-test rows (A/B) plus the new page test: 3 LP visitors (1 lead), 2 IF visitors (1 lead).
  const rows: Row[] = [
    row(1, "A", [1]), row(2, "B", [1, 2, 3]),
    row(10, "LP", [1, 2, 3, 4, 5, 6], true), row(11, "LP", [1, 2]), row(12, "LP", []),
    row(20, "IF", [1, 2, 3, 4, 5, 6, 7, 8, 9], true), row(21, "IF", [1, 2, 3]),
  ];
  const newRows = rows.slice(2);
  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
    prismaMock.$queryRaw
      .mockResolvedValueOnce(newRows) // sessions in range
      .mockResolvedValueOnce([]) // zip errors
      .mockResolvedValueOnce(rows); // every tagged session ever
  });
  const get = (qs = "") => funnel(new NextRequest(`http://x/api/admin/funnel?range=today${qs}`)).then((r) => r.json());

  it("compares LP (A) against IF (B), ignoring the October hero test", async () => {
    const d = await get();
    expect(d.abTestId).toBe("page");
    expect(d.abTest.id).toBe("page");
    expect(d.abTest.A).toMatchObject({ visitors: 3, started: 2, zipEntered: 1, reachedContact: 1, leads: 1 });
    expect(d.abTest.B).toMatchObject({ visitors: 2, started: 2, zipEntered: 2, reachedContact: 1, leads: 1 });
    expect(d.stepMode).toBe("milestones");
  });

  it("shows page B's own questions when filtered to B", async () => {
    const d = await get("&variant=B");
    expect(d.views).toBe(2);
    expect(d.steps.map((s: { label: string }) => s.label)).toEqual([
      "Visited page", "Trade (tap)", "ZIP code", "IUL interest", "Gross monthly income", "Monthly budget", "Retire by", "Age", "Beneficiary name", "Contact",
    ]);
  });

  it("shows the live page's questions when filtered to A", async () => {
    const d = await get("&variant=A");
    expect(d.views).toBe(3);
    expect(d.steps[1].label).toBe("Who are you protecting? (tap)");
  });
});
