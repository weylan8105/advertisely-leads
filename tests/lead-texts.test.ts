import { describe, it, expect } from "vitest";
import {
  arrivalText,
  missedCallText,
  withinTextingHours,
  formatPhone,
  leadTextsEnabled,
  textPools,
} from "@/lib/leadTexts";

// Pure parts of the lead texts (lib/leadTexts.ts): wording, quiet hours, switches.

describe("arrivalText", () => {
  it("names the agent, agency and their number for a lead in someone's pipeline", () => {
    const t = arrivalText({
      leadName: "Maria Lopez",
      agent: { name: "Josh Smith", agency: "Smith Insurance", phone: "+1 555 123 4567" },
    });
    expect(t).toContain("Hi Maria,");
    expect(t).toContain("your licensed agent is Josh Smith with Smith Insurance");
    expect(t).toContain("from (555) 123-4567");
    expect(t).toContain("Reply STOP to opt out.");
    expect(t).toContain("Enhanced Wealth");
  });

  it("names the agency, not one agent, for a team Goldmine lead (nobody owns it yet)", () => {
    const t = arrivalText({
      leadName: "Maria",
      agent: { name: "David Layton", agency: "Layton Financial", phone: "5551234567" },
      team: true,
    });
    expect(t).toContain("a licensed agent with Layton Financial will call you shortly");
    expect(t).not.toContain("(555)");
    expect(t).not.toContain("David Layton");
  });

  it("falls back to the owner's team when there's no agency", () => {
    expect(arrivalText({ leadName: "Maria", agent: { name: "David Layton" }, team: true })).toContain(
      "a licensed agent with David Layton's team",
    );
  });

  it("still makes sense with nothing known about the agent", () => {
    const t = arrivalText({ leadName: "", agent: null });
    expect(t.startsWith("Hi, it's Enhanced Wealth: a licensed agent will call you shortly")).toBe(true);
  });

  it("fits in two SMS segments", () => {
    const t = arrivalText({
      leadName: "Maria",
      agent: { name: "Josh Smith", agency: "Smith Family Insurance Group", phone: "5551234567" },
    });
    expect(t.length).toBeLessThanOrEqual(306);
  });
});

describe("missedCallText", () => {
  it("says who tried and from which number", () => {
    const t = missedCallText({ leadName: "Maria", caller: { name: "Josh Smith", agency: "Smith Insurance", phone: "555-123-4567" } })!;
    expect(t).toContain("Hi Maria, sorry we missed you.");
    expect(t).toContain("Josh Smith with Smith Insurance just tried to reach you");
    expect(t).toContain("from (555) 123-4567");
    expect(t).toContain("Reply STOP");
  });

  it("isn't sent when the caller has no usable phone on their profile", () => {
    expect(missedCallText({ leadName: "Maria", caller: { name: "Josh", phone: "" } })).toBeNull();
    expect(missedCallText({ leadName: "Maria", caller: { name: "Josh", phone: "12345" } })).toBeNull();
  });
});

describe("withinTextingHours (8am–9pm in the lead's state)", () => {
  it("allows 10am Central for a Texas lead", () => {
    expect(withinTextingHours("TX", new Date("2026-11-20T16:00:00Z"))).toBe(true); // 10:00 CST
  });
  it("blocks 7am Eastern for a Florida lead", () => {
    expect(withinTextingHours("FL", new Date("2026-11-20T12:00:00Z"))).toBe(false); // 07:00 EST
  });
  it("blocks 9pm local and allows 8:59pm", () => {
    expect(withinTextingHours("CA", new Date("2026-11-21T05:00:00Z"))).toBe(false); // 21:00 PST
    expect(withinTextingHours("CA", new Date("2026-11-21T04:59:00Z"))).toBe(true); // 20:59 PST
  });
  it("uses Central when the state is unknown", () => {
    expect(withinTextingHours("", new Date("2026-11-20T16:00:00Z"))).toBe(true);
  });
});

describe("formatPhone", () => {
  it("formats 10- and 11-digit US numbers and rejects others", () => {
    expect(formatPhone("+15551234567")).toBe("(555) 123-4567");
    expect(formatPhone("555.123.4567")).toBe("(555) 123-4567");
    expect(formatPhone("123")).toBeNull();
    expect(formatPhone(null)).toBeNull();
  });
});

describe("switches", () => {
  it("is off unless both the flag and the GHL token are set", () => {
    expect(leadTextsEnabled({} as any)).toBe(false);
    expect(leadTextsEnabled({ LEAD_TEXTS_ENABLED: "1" } as any)).toBe(false);
    expect(leadTextsEnabled({ GHL_TEXT_TOKEN: "x" } as any)).toBe(false);
    expect(leadTextsEnabled({ LEAD_TEXTS_ENABLED: "1", GHL_TEXT_TOKEN: "x" } as any)).toBe(true);
  });
  it("texts only Enhanced Wealth and ABCA pool leads by default", () => {
    expect([...textPools({} as any)].sort()).toEqual(["abca", "ew"]);
    expect([...textPools({ LEAD_TEXTS_POOLS: "ew, ewws" } as any)].sort()).toEqual(["ew", "ewws"]);
  });
});
