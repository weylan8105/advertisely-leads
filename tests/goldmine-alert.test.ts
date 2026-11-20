import { describe, it, expect, vi, beforeEach } from "vitest";

// The Goldmine new-lead alert (lib/goldmineAlert.ts): who gets emailed, and when not.

const db = {
  lead: { findUnique: vi.fn() },
  organization: { findUnique: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
};
vi.mock("@/lib/prisma", () => ({ prisma: db, isDatabaseConfigured: true }));
const sendGoldmineLeadAlertEmail = vi.fn(async () => ({ success: true }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: true, sendGoldmineLeadAlertEmail }));

const NOW = new Date("2026-11-20T16:00:00Z");
const freshLead = {
  name: "Maria Lopez",
  state: "TX",
  pipeline: "goldmine",
  goldmineAt: new Date(NOW.getTime() - 30_000),
  organizationId: "org1",
  assignedUserId: "owner",
};

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOLDMINE_LEAD_ALERTS;
  db.organization.findUnique.mockResolvedValue({
    name: "David's Team",
    ownerId: "owner",
    goldmineEnabled: true,
    memberships: [{ userId: "kyle" }, { userId: "owner" }],
  });
  db.user.findUnique.mockResolvedValue({ agency: "Layton Financial", name: "David Layton" });
  db.user.findMany.mockResolvedValue([
    { email: "david@example.com", name: "David Layton" },
    { email: "kyle@example.com", name: "Kyle V" },
    { email: null, name: "No Email" },
  ]);
});

describe("alertGoldmineTeamOfNewLead", () => {
  it("emails every agent with Goldmine access once, named by the owner's agency", async () => {
    db.lead.findUnique.mockResolvedValue(freshLead);
    const { alertGoldmineTeamOfNewLead } = await import("@/lib/goldmineAlert");
    expect(await alertGoldmineTeamOfNewLead("lead1", NOW)).toBe(2);
    expect(db.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["owner", "kyle"] } } }));
    expect(sendGoldmineLeadAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({ toEmail: "kyle@example.com", agentName: "Kyle", teamName: "Layton Financial", leadFirstName: "Maria", leadState: "TX" }),
    );
  });

  it("does nothing for a lead in someone's own pipeline", async () => {
    db.lead.findUnique.mockResolvedValue({ ...freshLead, pipeline: "main" });
    const { alertGoldmineTeamOfNewLead } = await import("@/lib/goldmineAlert");
    expect(await alertGoldmineTeamOfNewLead("lead1", NOW)).toBe(0);
    expect(sendGoldmineLeadAlertEmail).not.toHaveBeenCalled();
  });

  it("does nothing for an aged lead that was swept into Goldmine earlier", async () => {
    db.lead.findUnique.mockResolvedValue({ ...freshLead, goldmineAt: new Date(NOW.getTime() - 3 * 3600_000) });
    const { alertGoldmineTeamOfNewLead } = await import("@/lib/goldmineAlert");
    expect(await alertGoldmineTeamOfNewLead("lead1", NOW)).toBe(0);
  });

  it("can be switched off", async () => {
    process.env.GOLDMINE_LEAD_ALERTS = "0";
    db.lead.findUnique.mockResolvedValue(freshLead);
    const { alertGoldmineTeamOfNewLead } = await import("@/lib/goldmineAlert");
    expect(await alertGoldmineTeamOfNewLead("lead1", NOW)).toBe(0);
  });

  it("never throws", async () => {
    db.lead.findUnique.mockRejectedValue(new Error("db down"));
    const { alertGoldmineTeamOfNewLead } = await import("@/lib/goldmineAlert");
    expect(await alertGoldmineTeamOfNewLead("lead1", NOW)).toBe(0);
  });
});
