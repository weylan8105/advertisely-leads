import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Linking a form that was waiting: only the link step turns it on, and it pulls
// the leads that came in while it waited.

const upsert = vi.fn(async ({ update }: any) => ({ formId: "F1", ownerUserId: null, enabled: false, ...update }));
const findUnique = vi.fn(async () => ({ enabled: false, createdAt: new Date("2026-11-05T00:00:00Z") }));
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: {
    metaFormMapping: { findUnique, upsert },
    user: { findUnique: vi.fn(async () => ({ id: "U1", name: "Jace", email: "jace@gmail.com" })) },
  },
}));
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { role: "ADMIN" } })) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const pollMetaLeads = vi.fn(async () => []);
vi.mock("@/lib/metaLeadPoll", () => ({ pollMetaLeads, POLL_LOOKBACK_HOURS: 48 }));

const post = async (body: Record<string, unknown>) => {
  const { POST } = await import("@/app/api/admin/meta/forms/route");
  const base = { pageConnectionId: "PC", formId: "F1", formName: "Form", packageId: "blue-collar-iul" };
  return POST(new NextRequest("https://advertisely.io/api/admin/meta/forms", { method: "POST", body: JSON.stringify({ ...base, ...body }) }));
};

beforeEach(() => {
  upsert.mockClear();
  pollMetaLeads.mockClear();
});

describe("POST /api/admin/meta/forms", () => {
  it("doesn't turn a waiting form on when only its fields are saved", async () => {
    await post({ fieldMapping: { age_range: "age" } });
    const { update } = upsert.mock.calls[0][0] as any;
    expect(update).not.toHaveProperty("enabled");
    expect(update).not.toHaveProperty("ownerUserId");
    expect(pollMetaLeads).not.toHaveBeenCalled();
  });

  it("links the form to its owner and pulls the leads that waited", async () => {
    await post({ ownerEmail: "jace@gmail.com" });
    expect((upsert.mock.calls[0][0] as any).update).toMatchObject({ enabled: true, ownerUserId: "U1" });
    expect(pollMetaLeads).toHaveBeenCalledWith({ formId: "F1", since: new Date("2026-11-03T00:00:00Z") });
  });
});
