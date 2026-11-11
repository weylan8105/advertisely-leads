import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const update = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { lead: { update: (...a: unknown[]) => update(...a) } }, isDatabaseConfigured: true }));

import { fetchAdNames, fillAdNames, adNamesToFill } from "@/lib/adNames";

const graphAd = { id: "120250442628840207", name: "10/17/26 - Life Insurance 101", adset: { name: "10/17/26 - Life Insurance 101" }, campaign: { name: "Advertisely ABCA / Lead Purchase / Team Use" } };

describe("ad names from the Ads API", () => {
  beforeEach(() => {
    update.mockReset();
    vi.stubEnv("META_ADS_ACCESS_TOKEN", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => graphAd })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("fills a quiz lead's blank ad, ad set and campaign names from its ad id", async () => {
    const fill = await fillAdNames({ id: "L1", creativeId: "120250442628840207" });
    expect(fill).toEqual({ adName: "10/17/26 - Life Insurance 101", adsetName: "10/17/26 - Life Insurance 101", campaignName: "Advertisely ABCA / Lead Purchase / Team Use" });
    expect(update).toHaveBeenCalledWith({ where: { id: "L1" }, data: fill });
    const url = String((fetch as any).mock.calls[0][0]);
    expect(url).toContain("/120250442628840207?");
    expect(url).toContain("adset%7Bname%7D");
  });

  it("accepts the export form of an ad id and caches the lookup", async () => {
    await fetchAdNames("ag:120245300016610396");
    await fetchAdNames("120245300016610396");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an ad id, with a name already set, or without a token", async () => {
    expect(await fillAdNames({ id: "L2" })).toEqual({});
    expect(await fillAdNames({ id: "L3", creativeId: "120250442628840207", adName: "Set" })).toEqual({});
    vi.stubEnv("META_ADS_ACCESS_TOKEN", "");
    vi.stubEnv("META_ADS_MANAGE_TOKEN", "");
    expect(await fetchAdNames("120250442628010207")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("swallows Graph errors so the lead still goes on to delivery", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Unsupported get request" } }) })));
    expect(await fillAdNames({ id: "L4", creativeId: "120250000000000009" })).toEqual({});
    expect(update).not.toHaveBeenCalled();
  });

  it("only fills blanks", () => {
    expect(adNamesToFill({ id: "x", campaignName: "Mine" }, { adName: "A", adsetName: "S", campaignName: "C" })).toEqual({ adName: "A", adsetName: "S" });
  });
});
