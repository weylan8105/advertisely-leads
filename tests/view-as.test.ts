import { describe, it, expect } from "vitest";
import { isBlockedWhileViewing, viewAsTargetId } from "@/lib/viewAs";

describe("viewAsTargetId", () => {
  it("is only honored on an admin token", () => {
    expect(viewAsTargetId("ADMIN", "cmabc123xyz")).toBe("cmabc123xyz");
    expect(viewAsTargetId("AGENT", "cmabc123xyz")).toBeNull();
    expect(viewAsTargetId(undefined, "cmabc123xyz")).toBeNull();
  });
  it("ignores empty or malformed cookies", () => {
    expect(viewAsTargetId("ADMIN", undefined)).toBeNull();
    expect(viewAsTargetId("ADMIN", "")).toBeNull();
    expect(viewAsTargetId("ADMIN", "a b;c=1")).toBeNull();
  });
});

describe("isBlockedWhileViewing", () => {
  it("lets pages and reads through", () => {
    expect(isBlockedWhileViewing("GET", "/dashboard")).toBe(false);
    expect(isBlockedWhileViewing("GET", "/api/leads")).toBe(false);
    expect(isBlockedWhileViewing("HEAD", "/api/orders")).toBe(false);
  });
  it("refuses every change", () => {
    for (const m of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(isBlockedWhileViewing(m, "/api/leads/abc")).toBe(true);
    }
    expect(isBlockedWhileViewing("POST", "/api/checkout/create-payment-intent")).toBe(true);
    expect(isBlockedWhileViewing("POST", "/api/messages/send")).toBe(true);
  });
  it("refuses linking the client's Google Calendar", () => {
    expect(isBlockedWhileViewing("GET", "/api/integrations/google-calendar/connect")).toBe(true);
    expect(isBlockedWhileViewing("GET", "/api/integrations/google-calendar/callback")).toBe(true);
    expect(isBlockedWhileViewing("GET", "/api/integrations/google-calendar")).toBe(false);
  });
  it("always allows leaving client view and signing out", () => {
    expect(isBlockedWhileViewing("POST", "/api/admin/view-as")).toBe(false);
    expect(isBlockedWhileViewing("POST", "/api/auth/signout")).toBe(false);
  });
});
