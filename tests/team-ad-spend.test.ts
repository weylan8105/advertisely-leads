import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = {
  id: string; advertiserId: string; userId: string; kind: string; amountCents: number;
  grossCents?: number | null; processingFeeCents: number; cplCents?: number | null;
  leadId?: string | null; stripeRef?: string | null; createdAt: Date;
};

const { db, state } = vi.hoisted(() => {
  const state = {
    ledger: [] as any[],
    members: [] as { organizationId: string; userId: string; role: string; adSpendAccess: boolean; licensedStates: string[] }[],
    leads: new Map<string, { assignedUserId: string | null; trashedAt: null }>(),
    ownerLastTurn: null as Date | null,
    seq: 0,
  };
  const sumBy = (rows: any[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.userId, (m.get(r.userId) ?? 0) + r.amountCents);
    return m;
  };
  const match = (r: any, where: any) =>
    (!where.advertiserId || r.advertiserId === where.advertiserId) &&
    (!where.kind || r.kind === where.kind) &&
    (!where.userId || (typeof where.userId === "string" ? r.userId === where.userId : where.userId.in.includes(r.userId)));
  const db: any = {
    teamAdSpend: {
      groupBy: async ({ where, _sum, _max }: any) => {
        const rows = state.ledger.filter((r) => match(r, where));
        const ids = [...new Set(rows.map((r) => r.userId))];
        return ids.map((userId) => {
          const mine = rows.filter((r) => r.userId === userId);
          return {
            userId,
            ...(_sum ? { _sum: { amountCents: sumBy(mine).get(userId) ?? 0 } } : {}),
            ...(_max ? { _max: { createdAt: new Date(Math.max(...mine.map((r) => r.createdAt.getTime()))) } } : {}),
          };
        });
      },
      aggregate: async ({ where }: any) => ({
        _sum: { amountCents: state.ledger.filter((r) => match(r, where)).reduce((s, r) => s + r.amountCents, 0) },
      }),
      findMany: async ({ where }: any) => state.ledger.filter((r) => match(r, where)),
      create: async ({ data }: any) => {
        if (data.stripeRef && state.ledger.some((r) => r.stripeRef === data.stripeRef)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = { id: `t${++state.seq}`, processingFeeCents: 0, createdAt: new Date(Date.now() + state.seq), ...data };
        state.ledger.push(row);
        return row;
      },
    },
    organization: { findUnique: async () => ({ ownerId: "adv" }) },
    membership: {
      findMany: async ({ where }: any) =>
        state.members
          .filter((m) => m.organizationId === where.organizationId && m.adSpendAccess && m.role !== "OWNER" && m.userId !== "adv")
          .map((m) => ({ userId: m.userId, user: { licensedStates: m.licensedStates } })),
      count: async ({ where }: any) =>
        state.members.filter((m) => m.organizationId === where.organizationId && m.adSpendAccess && where.userId.in.includes(m.userId)).length,
    },
    lead: {
      updateMany: async ({ where, data }: any) => {
        const l = state.leads.get(where.id);
        if (!l || l.assignedUserId) return { count: 0 };
        l.assignedUserId = data.assignedUserId;
        return { count: 1 };
      },
    },
    $queryRaw: async () => [{ at: state.ownerLastTurn }],
    $transaction: async (fn: any) => fn(db),
  };
  return { db, state };
});

vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));

import {
  recordTeamPayment, fundedTeamRecipient, assignFundedLead, teamHasFundedMembers, teamBalances,
} from "@/lib/teamAdSpend";

const pay = (userId: string, gross: number, ref: string) =>
  recordTeamPayment({ advertiserId: "adv", userId, grossCents: gross, processingFeeCents: Math.round(gross * 0.03), stripeRef: ref });
const member = (userId: string, extra: Partial<(typeof state.members)[number]> = {}) =>
  state.members.push({ organizationId: "org", userId, role: "AGENT", adSpendAccess: true, licensedStates: [], ...extra });

beforeEach(() => {
  state.ledger = [];
  state.members = [];
  state.leads = new Map();
  state.ownerLastTurn = null;
  state.seq = 0;
});

describe("team ad spend credit", () => {
  it("credits what they paid after the 3% card fee, once per payment", async () => {
    expect(await pay("d1", 100000, "pi_1")).toBe(true);
    expect(await pay("d1", 100000, "pi_1")).toBe(false); // webhook retry
    expect((await teamBalances("adv")).get("d1")).toBe(97000);
  });

  it("only counts members the upline switched on, with credit", async () => {
    member("d1", { adSpendAccess: false });
    await pay("d1", 50000, "pi_1");
    expect(await teamHasFundedMembers("adv", "org")).toBe(false);
    state.members[0].adSpendAccess = true;
    expect(await teamHasFundedMembers("adv", "org")).toBe(true);
  });
});

describe("campaign lead rotation", () => {
  it("alternates between the advertiser and a funded downline", async () => {
    member("d1");
    await pay("d1", 100000, "pi_1");
    // Nobody served yet: the downline goes first.
    expect(await fundedTeamRecipient("adv", "org", "TX", 4000, "Adv")).toBe("d1");
    state.leads.set("L1", { assignedUserId: null, trashedAt: null });
    expect(await assignFundedLead({ leadId: "L1", advertiserId: "adv", userId: "d1", cplCents: 4000, leadData: {} })).toBe(true);
    // The advertiser hasn't had one since: their turn.
    state.ownerLastTurn = new Date(Date.now() - 60_000);
    expect(await fundedTeamRecipient("adv", "org", "TX", 4000, "Adv")).toBeNull();
    // After the advertiser's lead, back to the downline.
    state.ownerLastTurn = new Date(Date.now() + 60_000);
    expect(await fundedTeamRecipient("adv", "org", "TX", 4000, "Adv")).toBe("d1");
  });

  it("rotates across several funded downlines, least recently served first", async () => {
    member("d1");
    member("d2");
    await pay("d1", 100000, "pi_1");
    await pay("d2", 100000, "pi_2");
    state.ownerLastTurn = new Date(Date.now() + 1e9); // advertiser just had one
    const got: string[] = [];
    for (const id of ["L1", "L2", "L3", "L4"]) {
      state.leads.set(id, { assignedUserId: null, trashedAt: null });
      const pick = (await fundedTeamRecipient("adv", "org", "TX", 4000, "Adv"))!;
      await assignFundedLead({ leadId: id, advertiserId: "adv", userId: pick, cplCents: 4000, leadData: {} });
      got.push(pick);
    }
    expect(got.filter((g) => g === "d1")).toHaveLength(2);
    expect(got.filter((g) => g === "d2")).toHaveLength(2);
    expect(got[0]).not.toBe(got[1]);
  });

  it("skips downlines not licensed in the lead's state", async () => {
    member("d1", { licensedStates: ["FL"] });
    await pay("d1", 100000, "pi_1");
    expect(await fundedTeamRecipient("adv", "org", "TX", 4000, "Adv")).toBeNull();
    expect(await fundedTeamRecipient("adv", "org", "FL", 4000, "Adv")).toBe("d1");
  });

  it("skips downlines whose credit won't cover one lead, or who are switched off", async () => {
    member("d1");
    member("d2", { adSpendAccess: false });
    await pay("d1", 10000, "pi_1"); // $97 credit
    await pay("d2", 100000, "pi_2");
    expect(await fundedTeamRecipient("adv", "org", "TX", 9800, "Adv")).toBeNull();
    expect(await fundedTeamRecipient("adv", "org", "TX", 9700, "Adv")).toBe("d1");
  });

  it("takes the CPL at delivery from their credit, and never overdraws", async () => {
    member("d1");
    await pay("d1", 10000, "pi_1"); // 9700
    state.leads.set("L1", { assignedUserId: null, trashedAt: null });
    state.leads.set("L2", { assignedUserId: null, trashedAt: null });
    expect(await assignFundedLead({ leadId: "L1", advertiserId: "adv", userId: "d1", cplCents: 5000, leadData: {} })).toBe(true);
    expect((await teamBalances("adv")).get("d1")).toBe(4700);
    expect(await assignFundedLead({ leadId: "L2", advertiserId: "adv", userId: "d1", cplCents: 5000, leadData: {} })).toBe(false);
    expect(state.leads.get("L2")!.assignedUserId).toBeNull();
    expect((await teamBalances("adv")).get("d1")).toBe(4700);
  });

  it("doesn't charge for a lead someone else already took", async () => {
    member("d1");
    await pay("d1", 100000, "pi_1");
    state.leads.set("L1", { assignedUserId: "someone", trashedAt: null });
    expect(await assignFundedLead({ leadId: "L1", advertiserId: "adv", userId: "d1", cplCents: 4000, leadData: {} })).toBe(false);
    expect((await teamBalances("adv")).get("d1")).toBe(97000);
  });
});
