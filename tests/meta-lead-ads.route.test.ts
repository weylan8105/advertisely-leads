import { describe, it, expect, vi, beforeEach } from "vitest";

// Fills blank campaign and ad columns on stored form leads.

const db = vi.hoisted(() => ({ leads: [] as any[], role: "ADMIN" }));
const fill = vi.hoisted(() => vi.fn());

vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { role: db.role } })) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, prisma: { $queryRaw: vi.fn(async () => db.leads) } }));
vi.mock("@/lib/metaLeadId", () => ({ fillLeadAd: fill }));

import { POST } from "../app/api/admin/meta-lead-ads/route";

const post = (query = "") => POST(new Request(`https://x.test/api/admin/meta-lead-ads${query}`) as any);

beforeEach(() => {
  db.role = "ADMIN";
  db.leads = [{ id: "A" }, { id: "B" }, { id: "C" }];
  fill.mockReset();
  fill.mockResolvedValue({ fill: { campaignName: "Blue Collar ER", creativeId: "3300" } });
});

describe("POST /api/admin/meta-lead-ads", () => {
  it("is admin only", async () => {
    db.role = "CLIENT";
    expect((await post()).status).toBe(403);
    expect(fill).not.toHaveBeenCalled();
  });

  it("fills each lead and counts them by campaign", async () => {
    const body = await (await post()).json();
    expect(body).toMatchObject({ dryRun: false, found: 3, processed: 3, filled: 3, remaining: 0 });
    expect(body.campaigns).toEqual({ "Blue Collar ER": 3 });
  });

  it("passes a dry run through", async () => {
    const body = await (await post("?dry=1")).json();
    expect(body.dryRun).toBe(true);
    expect(fill).toHaveBeenCalledWith(db.leads[0], { dryRun: true });
  });

  it("reports leads Meta wouldn't fill, and keeps going after a failure", async () => {
    fill.mockResolvedValueOnce({ fill: {}, error: "no ad access" });
    fill.mockRejectedValueOnce(new Error("boom"));
    const body = await (await post()).json();
    expect(body).toMatchObject({ processed: 3, filled: 1, remaining: 0 });
    expect(body.errors).toEqual(["no ad access", "boom"]);
  });
});
