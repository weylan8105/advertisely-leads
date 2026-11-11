import { describe, it, expect } from "vitest";
import { normalizeInboundLead } from "@/lib/inboundLead";
import { looksHealthcare } from "@/lib/leadPackageClassify";

// GHL forwards every Essential Workers form through one workflow and never sends
// a package, so the lead bucket has to come from the answers themselves. This is
// the payload shape the "Advertisely - Essential Workers (Ryan)" workflow sends.
function ghlBody(customData: Record<string, string>) {
  return {
    full_name: "Test Nurse",
    email: "nurse@example.com",
    phone: "(503) 555-0100",
    state: "oregon",
    customData: JSON.stringify({ owner_email: "ryan@example.com", ...customData }),
    workflow: JSON.stringify({ id: "wf", name: "Advertisely - Essential Workers (Ryan)" }),
  };
}

describe("nurse leads land in the Nurse IUL bucket", () => {
  it.each([
    "Registered Nurse (RN)",
    "Licensed Practical Nurse (LPN/LVN)",
    "Other healthcare role",
    "CNA / Medical Assistant",
    "CNA",
  ])("occupation %s", (occupation) => {
    expect(normalizeInboundLead(ghlBody({ occupation, Trade: occupation })).packageId).toBe("healthcare-iul");
  });

  it("keeps blue-collar trades on the default package", () => {
    expect(normalizeInboundLead(ghlBody({ occupation: "Electrician", Trade: "Electrician" })).packageId).toBe("blue-collar-iul");
    expect(normalizeInboundLead(ghlBody({})).packageId).toBe("blue-collar-iul");
  });

  it("upgrades a nurse out of an explicit Blue-Collar package but never off a non-IUL one", () => {
    expect(normalizeInboundLead(ghlBody({ occupation: "Registered Nurse (RN)", packageId: "blue-collar-iul" })).packageId).toBe("healthcare-iul");
    expect(normalizeInboundLead(ghlBody({ occupation: "Registered Nurse (RN)", packageId: "trucker-leads" })).packageId).toBe("trucker-leads");
  });

  it("also reads the form or campaign name when there is no occupation", () => {
    expect(normalizeInboundLead(ghlBody({ campaign_name: "EWWS - Nurses - Instant Form - Closed Deals" })).packageId).toBe("healthcare-iul");
    expect(normalizeInboundLead(ghlBody({ campaign_name: "EWWS - Blue Collar - Instant Form - Closed Deals" })).packageId).toBe("blue-collar-iul");
    expect(looksHealthcare("EWWS - Nurses - Instant Form")).toBe(true);
    // "Earn" and "Turner" must not trip the RN match
    expect(looksHealthcare("Earn more as a welder", "Turner")).toBe(false);
  });
});
