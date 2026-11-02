import { describe, it, expect, vi, beforeEach } from "vitest";

// Characterization tests for the Ad Bulk Uploader's Meta writes. fetch is
// mocked — nothing reaches Meta. They pin the payloads we send (everything
// PAUSED, lead-form wiring, special ad category) so a refactor can't drift.

vi.mock("@/lib/prisma", () => ({ prisma: null, isDatabaseConfigured: false }));
process.env.META_ADS_MANAGE_TOKEN = "test-token";

type Call = { url: string; params: Record<string, string> };
let calls: Call[] = [];
let replies: Array<{ ok?: boolean; body: unknown }> = [];

beforeEach(() => {
  calls = [];
  replies = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const params = init?.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : Object.fromEntries(new URL(url).searchParams);
    calls.push({ url: url.split("?")[0], params });
    const r = replies.shift() ?? { body: { id: "1" } };
    return { ok: r.ok ?? true, status: r.ok === false ? 400 : 200, json: async () => r.body } as Response;
  }));
});

const ctx = { accountId: "123", pageId: "PAGE", financialCategory: true };
const adset = {
  row: 2, name: "Set", dailyBudgetCents: 5000, destination: "FORM" as const, leadFormId: "777",
  states: ["FL"], ageMin: 35, ageMax: 60, startDate: "", ads: [],
};
const ad = {
  row: 2, name: "Ad 1", media: "a.jpg", mediaType: "image" as const, mediaIsUrl: false,
  primaryText: "Copy", headline: "Head", description: "", cta: "SIGN_UP" as const, linkUrl: "", urlTags: "utm_source=fb",
};

describe("metaAds", () => {
  it("creates campaigns paused with the financial special ad category", async () => {
    const { createCampaign } = await import("@/lib/metaAds");
    replies.push({ body: { id: "C1" } });
    expect(await createCampaign(ctx, { name: "Camp", objective: "LEADS" })).toBe("C1");
    expect(calls[0].url).toMatch(/\/act_123\/campaigns$/);
    expect(calls[0].params).toMatchObject({
      name: "Camp",
      objective: "OUTCOME_LEADS",
      status: "PAUSED",
      special_ad_categories: '["FINANCIAL_PRODUCTS_SERVICES"]',
      special_ad_category_country: '["US"]',
    });
    expect(calls[0].params.is_adset_budget_sharing_enabled).toBeUndefined();
  });

  it("retries with is_adset_budget_sharing_enabled only when Meta asks for it", async () => {
    const { createCampaign } = await import("@/lib/metaAds");
    replies.push({ ok: false, body: { error: { message: "Must specify is_adset_budget_sharing_enabled" } } });
    replies.push({ body: { id: "C2" } });
    expect(await createCampaign(ctx, { name: "Camp", objective: "LEADS" })).toBe("C2");
    expect(calls[1].params.is_adset_budget_sharing_enabled).toBe("false");
  });

  it("builds an instant-form ad set targeting state regions, ages locked by the category", async () => {
    const { createAdSet } = await import("@/lib/metaAds");
    replies.push({ body: { data: [{ key: "3847", name: "Florida", type: "region", country_code: "US" }] } });
    replies.push({ body: { id: "S1" } });
    expect(await createAdSet(ctx, "C1", "LEADS", adset)).toBe("S1");
    expect(calls[0].params).toMatchObject({ type: "adgeolocation", q: "Florida" });
    const p = calls[1].params;
    expect(p).toMatchObject({
      campaign_id: "C1",
      daily_budget: "5000",
      optimization_goal: "LEAD_GENERATION",
      destination_type: "ON_AD",
      status: "PAUSED",
      promoted_object: '{"page_id":"PAGE"}',
    });
    expect(JSON.parse(p.targeting)).toMatchObject({ geo_locations: { regions: [{ key: "3847" }] }, age_min: 18, age_max: 65 });
  });

  it("needs a pixel for website lead ad sets", async () => {
    const { createAdSet } = await import("@/lib/metaAds");
    await expect(createAdSet(ctx, "C1", "LEADS", { ...adset, states: [], destination: "WEBSITE" })).rejects.toThrow(/pixel/);
  });

  it("creates a lead-form image creative and a paused ad", async () => {
    const { createAd } = await import("@/lib/metaAds");
    replies.push({ body: { id: "CR1" } });
    replies.push({ body: { id: "AD1" } });
    expect(await createAd(ctx, "S1", adset, ad, { imageHash: "HASH" })).toEqual({ adId: "AD1", creativeId: "CR1" });
    const spec = JSON.parse(calls[0].params.object_story_spec);
    expect(spec).toMatchObject({
      page_id: "PAGE",
      link_data: {
        image_hash: "HASH",
        link: "http://fb.me/",
        message: "Copy",
        name: "Head",
        call_to_action: { type: "SIGN_UP", value: { lead_gen_form_id: "777" } },
      },
    });
    expect(calls[0].params.url_tags).toBe("utm_source=fb");
    expect(calls[1].params).toMatchObject({ adset_id: "S1", status: "PAUSED", creative: '{"creative_id":"CR1"}' });
  });

  it("surfaces Meta's user-facing error text", async () => {
    const { createAd } = await import("@/lib/metaAds");
    replies.push({ ok: false, body: { error: { message: "Invalid parameter", error_user_title: "Form archived", error_user_msg: "Pick an active form." } } });
    await expect(createAd(ctx, "S1", adset, ad, { imageHash: "HASH" })).rejects.toThrow("Form archived: Pick an active form.");
  });
});
