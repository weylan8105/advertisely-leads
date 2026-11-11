import { describe, it, expect } from "vitest";
import { normalizeInboundLead, ghlAdAttribution } from "@/lib/inboundLead";
import { adColumnsToFill } from "@/lib/metaLeadId";

const ghlAttribution = {
  sessionSource: "Paid Social",
  medium: "facebook",
  formId: "1415210107013222",
  formName: "EWWS - Nurse Lead Form 11/07",
  campaign: "EWWS - Nurses - Instant Form - Closed Deals",
  campaignId: "120249692494360601",
  utmMedium: "11/08/26 - Nurses - Why Work Until 65",
  utmContent: "11/08/26 - AI Nurse ad 3 - Why Work Until 65",
  adSetId: "120249710036290601",
  adId: "120249710045080601",
  utmSource: "facebook",
};

describe("ad name and ad set name on inbound leads", () => {
  it("reads them from GHL's Facebook lead attribution", () => {
    const lead = normalizeInboundLead({
      full_name: "Dena Malcom", phone: "(555) 555-0100", email: "d@example.com", state: "oregon",
      utm_medium: "", utm_content: "",
      contact: JSON.stringify({ attributionSource: ghlAttribution, lastAttributionSource: ghlAttribution }),
      attributionSource: JSON.stringify(ghlAttribution),
    });
    expect(lead.attribution.adName).toBe("11/08/26 - AI Nurse ad 3 - Why Work Until 65");
    expect(lead.attribution.adsetName).toBe("11/08/26 - Nurses - Why Work Until 65");
    expect(lead.attribution.creativeId).toBe("120249710045080601");
    expect(lead.attribution.adsetId).toBe("120249710036290601");
    expect(lead.attribution.campaignName).toBe("EWWS - Nurses - Instant Form - Closed Deals");
  });

  it("uses the submission that fired the webhook, not the contact's first touch", () => {
    const first = { ...ghlAttribution, adId: "111111111111111", utmContent: "Old ad" };
    expect(ghlAdAttribution({ contact: { attributionSource: first, lastAttributionSource: ghlAttribution } })?.adName)
      .toBe("11/08/26 - AI Nurse ad 3 - Why Work Until 65");
    expect(ghlAdAttribution({ full_name: "x" })).toBeNull();
  });

  it("an explicit ad_name from a connector wins", () => {
    const lead = normalizeInboundLead({
      full_name: "A B", phone: "5555550100", ad_name: "Hook 2", adset_name: "Set B", ad_id: "120250000000000001",
      attributionSource: JSON.stringify(ghlAttribution),
    });
    expect(lead.attribution.adName).toBe("Hook 2");
    expect(lead.attribution.adsetName).toBe("Set B");
    expect(lead.attribution.creativeId).toBe("120250000000000001");
  });

  it("treats the quiz funnel's utm_content ad id as the ad id", () => {
    const lead = normalizeInboundLead({ full_name: "A B", phone: "5555550100", source: "early-retirement-quiz", utm_content: "120250293189070207" });
    expect(lead.attribution.creativeId).toBe("120250293189070207");
    expect(lead.attribution.adName).toBeUndefined();
    const named = normalizeInboundLead({ full_name: "A B", phone: "5555550100", utm_content: "Retire at 55 creative" });
    expect(named.attribution.creativeId).toBeUndefined();
  });

  it("leaves names blank when the payload has none", () => {
    const lead = normalizeInboundLead({ full_name: "A B", phone: "5555550100" });
    expect(lead.attribution.adName).toBeUndefined();
    expect(lead.attribution.adsetName).toBeUndefined();
  });
});

describe("Meta fills ad names it knows", () => {
  it("fills blank names and leaves set ones alone", () => {
    const ad = { ad_id: "1", ad_name: "AI Nurse ad 3", adset_id: "2", adset_name: "Nurses - Why Work Until 65", campaign_id: "3", campaign_name: "EWWS - Nurses" };
    expect(adColumnsToFill({}, ad)).toEqual({
      campaignName: "EWWS - Nurses", utmCampaign: "EWWS - Nurses", adsetId: "2", creativeId: "1",
      adName: "AI Nurse ad 3", adsetName: "Nurses - Why Work Until 65",
    });
    expect(adColumnsToFill({ adName: "Kept", adsetName: "Kept set", campaignName: "c", utmCampaign: "c", adsetId: "2", creativeId: "1" }, ad)).toEqual({});
  });
});
