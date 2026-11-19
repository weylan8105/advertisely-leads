import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// createAdSet must leave Audience Network out of every new ad set, and if Meta
// refuses manual placements it must still create the ad set and say so.

const adset = {
  row: 2, name: "Set 1", dailyBudgetCents: 9700, destination: "FORM" as const, leadFormId: "111",
  states: [], ageMin: 18, ageMax: 65, startDate: "", ads: [],
};
const ctx = { accountId: "2126340781245705", pageId: "999", financialCategory: true } as any;

function targetingOf(call: unknown[]): Record<string, unknown> {
  const body = (call[1] as RequestInit).body as URLSearchParams;
  return JSON.parse(body.get("targeting") as string);
}

describe("createAdSet placements", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.resetModules();
    process.env.META_ADS_MANAGE_TOKEN = "test-token";
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists Facebook, Instagram and Messenger only (no Audience Network)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "adset_1" }) });
    const { createAdSet } = await import("@/lib/metaAds");
    const r = await createAdSet(ctx, "camp_1", "LEADS", adset);
    expect(r).toEqual({ id: "adset_1" });
    const t = targetingOf(fetchMock.mock.calls[0]);
    expect(t.publisher_platforms).toEqual(["facebook", "instagram", "messenger"]);
    expect(t.publisher_platforms).not.toContain("audience_network");
  });

  it("falls back to automatic placements with a warning when Meta refuses manual ones", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false, status: 400,
        json: async () => ({ error: { message: "Manual placements are not available for this objective", code: 100 } }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "adset_2" }) });
    const { createAdSet } = await import("@/lib/metaAds");
    const r = await createAdSet(ctx, "camp_1", "LEADS", adset);
    expect(r.id).toBe("adset_2");
    expect(r.warning).toMatch(/Audience Network/);
    expect(targetingOf(fetchMock.mock.calls[1]).publisher_platforms).toBeUndefined();
  });

  it("doesn't retry other errors", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ error: { message: "Invalid daily budget", code: 100 } }),
    });
    const { createAdSet } = await import("@/lib/metaAds");
    await expect(createAdSet(ctx, "camp_1", "LEADS", adset)).rejects.toThrow(/daily budget/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
