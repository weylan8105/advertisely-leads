import { describe, it, expect, vi, beforeEach } from "vitest";

const { db, users } = vi.hoisted(() => {
  const users: Record<string, { id: string; name: string | null; email: string; image: string | null; role: string }> = {
    client1: { id: "client1", name: "Casey Client", email: "casey@example.com", image: null, role: "AGENT" },
    admin2: { id: "admin2", name: "Other Admin", email: "other@example.com", image: null, role: "ADMIN" },
  };
  const db = { user: { findUnique: async ({ where }: { where: { id: string } }) => users[where.id] ?? null } };
  return { db, users };
});
vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
let jar: Record<string, string> = {};
vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (n: string) => (n in jar ? { value: jar[n] } : undefined),
    delete: (n: string) => { delete jar[n]; },
  }),
}));

import { authOptions } from "@/lib/auth";

async function sessionFor(role: string) {
  const base = { user: { name: "Ryan Admin", email: "ryan@example.com", image: null }, expires: "" };
  return (await authOptions.callbacks!.session!({ session: base, token: { id: "admin1", role } } as any)) as any;
}

describe("view as client session", () => {
  beforeEach(() => { jar = {}; });

  it("becomes the client's account for an admin with the cookie", async () => {
    jar.adv_view_as = "client1";
    const s = await sessionFor("ADMIN");
    expect(s.user).toMatchObject({ id: "client1", role: "AGENT", name: "Casey Client", email: "casey@example.com", viewingAs: true });
  });

  it("never hands out admin through another admin's account", async () => {
    jar.adv_view_as = "admin2";
    const s = await sessionFor("ADMIN");
    expect(s.user.id).toBe("admin2");
    expect(s.user.role).toBe("AGENT");
  });

  it("does nothing for a non-admin who sets the cookie", async () => {
    jar.adv_view_as = "client1";
    const s = await sessionFor("AGENT");
    expect(s.user.id).toBe("admin1");
    expect(s.user.viewingAs).toBeUndefined();
  });

  it("keeps the admin's own account but offers the exit when the client is gone", async () => {
    jar.adv_view_as = "deleted99";
    const s = await sessionFor("ADMIN");
    expect(s.user).toMatchObject({ id: "admin1", role: "ADMIN", viewingAs: true });
  });

  it("wins over user mode", async () => {
    jar.adv_view_as = "client1";
    jar.adv_user_mode = "1";
    const s = await sessionFor("ADMIN");
    expect(s.user.id).toBe("client1");
    expect(s.user.userMode).toBeUndefined();
  });

  it("clears on sign-out", async () => {
    jar.adv_view_as = "client1";
    await authOptions.events!.signOut!({} as any);
    expect(jar.adv_view_as).toBeUndefined();
  });
});
