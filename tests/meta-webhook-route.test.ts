import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { NextRequest } from "next/server";

// A lead on a form nobody linked: flag the form once, and never let that step
// fail the delivery Meta is waiting on.

const findUnique = vi.fn();
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  prisma: { metaFormMapping: { findUnique } },
}));
const flagUnlinkedForm = vi.fn(async () => null);
vi.mock("@/lib/metaLeadPoll", () => ({ flagUnlinkedForm, ingestMetaLead: vi.fn() }));

const SECRET = "app-secret";
const post = async () => {
  const body = JSON.stringify({
    object: "page",
    entry: [{ id: "P", time: 1, changes: [{ field: "leadgen", value: { leadgen_id: "L1", page_id: "P", form_id: "F1", created_time: 1 } }] }],
  });
  const signature = "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");
  const { POST } = await import("@/app/api/webhooks/meta/route");
  return POST(new NextRequest("https://advertisely.io/api/webhooks/meta", { method: "POST", body, headers: { "x-hub-signature-256": signature } }));
};

beforeEach(() => {
  process.env.META_APP_SECRET = SECRET;
  findUnique.mockReset();
  flagUnlinkedForm.mockClear();
});

describe("POST /api/webhooks/meta", () => {
  it("flags a form with no mapping", async () => {
    findUnique.mockResolvedValue(null);
    const res = await post();
    expect(await res.json()).toMatchObject({ ok: true, skipped: 1 });
    expect(flagUnlinkedForm).toHaveBeenCalledWith("P", "F1");
  });

  it("doesn't flag a form already waiting to be linked", async () => {
    findUnique.mockResolvedValue({ enabled: false, pageConnection: {} });
    await post();
    expect(flagUnlinkedForm).not.toHaveBeenCalled();
  });

  it("still answers Meta when flagging fails", async () => {
    findUnique.mockResolvedValue(null);
    flagUnlinkedForm.mockRejectedValueOnce(new Error("Graph down"));
    const res = await post();
    expect(res.status).toBe(200);
  });
});
