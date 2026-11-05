import { describe, it, expect, vi, beforeEach } from "vitest";

const getServerSession = vi.fn();
vi.mock("next-auth", () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { POST } from "@/app/api/admin/user-mode/route";
import { USER_MODE_COOKIE, isUserModeActive } from "@/lib/userMode";

function req(body: unknown) {
  return new Request("http://localhost/api/admin/user-mode", {
    method: "POST",
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("isUserModeActive", () => {
  it("only applies to a signed ADMIN token with the cookie set", () => {
    expect(isUserModeActive("ADMIN", "1")).toBe(true);
    expect(isUserModeActive("ADMIN", undefined)).toBe(false);
    expect(isUserModeActive("AGENT", "1")).toBe(false);
    expect(isUserModeActive(undefined, "1")).toBe(false);
  });
});

describe("POST /api/admin/user-mode", () => {
  beforeEach(() => getServerSession.mockReset());

  it("rejects signed-out visitors and clients", async () => {
    getServerSession.mockResolvedValue(null);
    expect((await POST(req({ enabled: true }))).status).toBe(401);
    getServerSession.mockResolvedValue({ user: { id: "u1", role: "AGENT" } });
    expect((await POST(req({ enabled: true }))).status).toBe(403);
  });

  it("turns on for an admin", async () => {
    getServerSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    const res = await POST(req({ enabled: true }));
    expect(res.status).toBe(200);
    expect(res.cookies.get(USER_MODE_COOKIE)?.value).toBe("1");
  });

  it("lets an admin in user mode back out, even though the session says client", async () => {
    getServerSession.mockResolvedValue({ user: { id: "a1", role: "AGENT", userMode: true } });
    const res = await POST(req({ enabled: false }));
    expect(res.status).toBe(200);
    expect(res.cookies.get(USER_MODE_COOKIE)?.value).toBeFalsy();
  });

  it("requires an explicit on or off", async () => {
    getServerSession.mockResolvedValue({ user: { id: "a1", role: "ADMIN" } });
    expect((await POST(req({}))).status).toBe(400);
  });
});
