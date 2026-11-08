import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Upline codes (lib/upline.ts) + the routes that use them: signup with a code,
 * joining from the Team page, approving a joiner, and the approval gate on the
 * team's shared leads. In-memory fake prisma with SYNTHETIC data only.
 */

type U = { id: string; name: string | null; email: string; agency: string | null; referralCode: string | null; defaultOrganizationId: string | null; passwordHash?: string | null };
type O = { id: string; name: string; ownerId: string; distributionMode: string; createdAt: Date };
type M = { id: string; organizationId: string; userId: string; role: string; inRotation: boolean; goldmineBlocked: boolean; createdAt: Date };

let users: U[] = [];
let orgs: O[] = [];
let mems: M[] = [];
let ords: { id: string; userId: string; organizationId: string }[] = [];
let lds: { id: string; orderId: string; organizationId: string; pipeline: string }[] = [];
let seq = 0;
const id = (p: string) => `${p}_${++seq}`;
const tick = () => new Date(Date.UTC(2026, 0, 1) + ++seq * 1000);

function matchUser(where: any) {
  return users.find((u) =>
    where.id ? u.id === where.id : where.referralCode ? u.referralCode === where.referralCode : where.email ? u.email === where.email : false,
  );
}
function findMem(where: any) {
  if (where.id) return mems.find((m) => m.id === where.id);
  const k = where.organizationId_userId;
  return mems.find((m) => m.organizationId === k.organizationId && m.userId === k.userId);
}
const withOrg = (m: M | undefined, include: any) =>
  m && include?.organization ? { ...m, organization: orgs.find((o) => o.id === m.organizationId) } : m;

const db = {
  user: {
    findUnique: vi.fn(async ({ where }: any) => matchUser(where) ?? null),
    findMany: vi.fn(async ({ where }: any) => users.filter((u) => where.id.in.includes(u.id))),
    create: vi.fn(async ({ data }: any) => {
      const u = { id: id("u"), name: null, agency: null, referralCode: null, defaultOrganizationId: null, ...data };
      users.push(u);
      return u;
    }),
    update: vi.fn(async ({ where, data }: any) => Object.assign(matchUser(where)!, data)),
  },
  organization: {
    findFirst: vi.fn(async ({ where }: any) =>
      orgs.filter((o) => o.ownerId === where.ownerId).sort((a, b) => +a.createdAt - +b.createdAt)[0] ?? null,
    ),
    findUnique: vi.fn(async ({ where }: any) => orgs.find((o) => o.id === where.id) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const o = { id: id("org"), createdAt: tick(), ...data };
      orgs.push(o);
      return o;
    }),
  },
  membership: {
    findUnique: vi.fn(async ({ where, include }: any) => withOrg(findMem(where), include) ?? null),
    findFirst: vi.fn(async ({ where, include }: any) =>
      withOrg(mems.filter((m) => m.userId === where.userId).sort((a, b) => +a.createdAt - +b.createdAt)[0], include) ?? null,
    ),
    create: vi.fn(async ({ data }: any) => {
      if (findMem({ organizationId_userId: data })) throw Object.assign(new Error("dup"), { code: "P2002" });
      const m = { id: id("m"), role: "AGENT", inRotation: true, goldmineBlocked: false, createdAt: tick(), ...data };
      mems.push(m);
      return m;
    }),
    update: vi.fn(async ({ where, data }: any) => Object.assign(findMem(where)!, data)),
    findMany: vi.fn(async ({ where }: any) =>
      mems
        .filter((m) => m.userId === where.userId && m.role === where.role && m.organizationId !== where.organizationId.not)
        .map((m) => ({ id: m.id, organizationId: m.organizationId, organization: orgs.find((o) => o.id === m.organizationId) })),
    ),
    deleteMany: vi.fn(async ({ where }: any) => {
      const before = mems.length;
      mems = mems.filter((m) => !where.id.in.includes(m.id));
      return { count: before - mems.length };
    }),
    delete: vi.fn(async ({ where }: any) => {
      mems = mems.filter((m) => m.id !== where.id);
    }),
  },
  order: {
    findMany: vi.fn(async ({ where }: any) =>
      ords.filter((o) => o.userId === where.userId && where.organizationId.in.includes(o.organizationId)),
    ),
    updateMany: vi.fn(async ({ where, data }: any) => {
      for (const o of ords) if (where.id.in.includes(o.id)) Object.assign(o, data);
    }),
  },
  lead: {
    updateMany: vi.fn(async ({ where, data }: any) => {
      for (const l of lds)
        if (where.orderId.in.includes(l.orderId) && where.organizationId.in.includes(l.organizationId) && l.pipeline === where.pipeline)
          Object.assign(l, data);
    }),
  },
  invitation: { findUnique: vi.fn(async () => null) },
  $executeRaw: vi.fn(async () => 0),
  $transaction: vi.fn(async (ops: any) => (typeof ops === "function" ? ops(db) : Promise.all(ops))),
};

vi.mock("@/lib/prisma", () => ({ isDatabaseConfigured: true, get prisma() { return db; } }));
let sessionUserId: string | null = null;
vi.mock("next-auth", () => ({ getServerSession: async () => (sessionUserId ? { user: { id: sessionUserId } } : null) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
const sendUplineJoinEmail = vi.fn(async () => ({ success: true }));
vi.mock("@/lib/email", () => ({ isEmailConfigured: true, sendUplineJoinEmail: (...a: unknown[]) => sendUplineJoinEmail(...(a as [])) }));
vi.mock("@/lib/referral", () => ({ ensureReferralCode: vi.fn(async () => null) }));
vi.mock("@/lib/password", () => ({ hashPassword: async () => "hash" }));

import { resolveUplineCode, joinUplineTeam } from "@/lib/upline";
import { canActOnLead } from "@/lib/leadAccess";
import { POST as register } from "@/app/api/auth/register/route";
import { POST as join } from "@/app/api/team/join/route";
import { GET as lookup } from "@/app/api/team/code/route";
import { PATCH as patchMember } from "@/app/api/team/members/[id]/route";
import { POST as leave } from "@/app/api/team/leave/route";

function addUser(name: string, code: string | null): U {
  const u: U = { id: id("u"), name, email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`, agency: null, referralCode: code, defaultOrganizationId: null };
  users.push(u);
  return u;
}
function addTeam(owner: U, name = `${owner.name}'s Team`): O {
  const o: O = { id: id("org"), name, ownerId: owner.id, distributionMode: "MANUAL", createdAt: tick() };
  orgs.push(o);
  addMember(o, owner, "OWNER");
  owner.defaultOrganizationId ??= o.id;
  return o;
}
function addMember(o: O, u: U, role = "AGENT", extra: Partial<M> = {}): M {
  const m: M = { id: id("m"), organizationId: o.id, userId: u.id, role, inRotation: true, goldmineBlocked: false, createdAt: tick(), ...extra };
  mems.push(m);
  return m;
}
const jsonReq = (url: string, body: unknown, method = "POST") =>
  new Request(url, { method, headers: { "content-type": "application/json", "x-real-ip": `198.51.100.${++seq % 250}` }, body: JSON.stringify(body) }) as any;

let ryan: U;
let ryansTeam: O;
beforeEach(() => {
  users = [];
  orgs = [];
  mems = [];
  ords = [];
  lds = [];
  sessionUserId = null;
  sendUplineJoinEmail.mockClear();
  ryan = addUser("Ryan Test", "RYAN7K");
  ryansTeam = addTeam(ryan);
});

describe("resolveUplineCode", () => {
  it("finds the team the code's owner runs, case- and space-insensitive", async () => {
    const r = await resolveUplineCode("  ryan-7k ");
    expect(r).toMatchObject({ code: "RYAN7K", uplineUserId: ryan.id, organizationId: ryansTeam.id, teamName: "Ryan Test's Team" });
  });

  it("returns null for unknown or junk codes", async () => {
    expect(await resolveUplineCode("NOPE99")).toBeNull();
    expect(await resolveUplineCode("")).toBeNull();
    expect(await resolveUplineCode(42)).toBeNull();
  });

  it("an agent on someone else's team recruits into the team they own", async () => {
    const wylie = addUser("Wylie Test", "WYLIE2X");
    const wyliesTeam = addTeam(wylie);
    addMember(ryansTeam, wylie);
    wylie.defaultOrganizationId = ryansTeam.id; // active team = Ryan's, where they're an agent
    expect((await resolveUplineCode("WYLIE2X"))?.organizationId).toBe(wyliesTeam.id);
  });

  it("an admin of a team recruits into that team", async () => {
    const ana = addUser("Ana Test", "ANA9Q");
    addTeam(ana);
    addMember(ryansTeam, ana, "ADMIN");
    ana.defaultOrganizationId = ryansTeam.id;
    expect((await resolveUplineCode("ANA9Q"))?.organizationId).toBe(ryansTeam.id);
  });
});

describe("joinUplineTeam", () => {
  it("joins with Goldmine on, out of rotation, and makes it the active team", async () => {
    const newbie = addUser("New Agent", null);
    const r = await joinUplineTeam(newbie.id, "RYAN7K");
    expect(r).toMatchObject({ status: "joined", organizationId: ryansTeam.id });
    const m = mems.find((x) => x.userId === newbie.id)!;
    expect(m).toMatchObject({ organizationId: ryansTeam.id, role: "AGENT", inRotation: false, goldmineBlocked: false });
    expect(newbie.defaultOrganizationId).toBe(ryansTeam.id);
    expect(sendUplineJoinEmail).toHaveBeenCalledWith(expect.objectContaining({ toEmail: ryan.email, teamName: ryansTeam.name, joinerName: "New Agent" }));
  });

  it("refuses your own code and unknown codes", async () => {
    expect((await joinUplineTeam(ryan.id, "RYAN7K")).status).toBe("own-code");
    expect((await joinUplineTeam(ryan.id, "ZZZZ99")).status).toBe("invalid");
  });

  it("is a no-op for someone already on the team", async () => {
    const vet = addUser("Vet Agent", null);
    addMember(ryansTeam, vet);
    expect((await joinUplineTeam(vet.id, "RYAN7K")).status).toBe("already-member");
    expect(mems.filter((m) => m.userId === vet.id)).toHaveLength(1);
    expect(sendUplineJoinEmail).not.toHaveBeenCalled();
  });

  it("transfers: joining a new upline's team takes them off the old one", async () => {
    const david = addUser("David Test", "DAVID1X");
    const davidsTeam = addTeam(david);
    const jordan = addUser("Jordan Test", "JORDAN2");
    const jordansTeam = addTeam(jordan);
    const trevor = addUser("Trevor Test", null);
    const trevorsOwn = addTeam(trevor);
    addMember(davidsTeam, trevor, "AGENT", { goldmineBlocked: true, inRotation: false });
    trevor.defaultOrganizationId = davidsTeam.id;
    addMember(ryansTeam, trevor, "ADMIN"); // helps run Ryan's team: stays
    ords.push({ id: "ord_t", userId: trevor.id, organizationId: davidsTeam.id }); // bought while on David's team
    ords.push({ id: "ord_d", userId: david.id, organizationId: davidsTeam.id });
    lds.push({ id: "l_main", orderId: "ord_t", organizationId: davidsTeam.id, pipeline: "main" });
    lds.push({ id: "l_gold", orderId: "ord_t", organizationId: davidsTeam.id, pipeline: "goldmine" });

    const r = await joinUplineTeam(trevor.id, "JORDAN2");
    expect(r).toMatchObject({ status: "joined", organizationId: jordansTeam.id, left: ["David Test's Team"] });
    const teams = mems.filter((m) => m.userId === trevor.id).map((m) => m.organizationId).sort();
    expect(teams).toEqual([trevorsOwn.id, ryansTeam.id, jordansTeam.id].sort());
    expect(trevor.defaultOrganizationId).toBe(jordansTeam.id);
    // Their own purchase moves with them; David's order and the Goldmine pool stay.
    expect(ords.map((o) => [o.id, o.organizationId])).toEqual([["ord_t", jordansTeam.id], ["ord_d", davidsTeam.id]]);
    expect(lds.map((l) => [l.id, l.organizationId])).toEqual([["l_main", jordansTeam.id], ["l_gold", davidsTeam.id]]);
  });

  it("re-entering the code of a team they're already on still moves them off the others", async () => {
    const david = addUser("David Test", "DAVID1X");
    const davidsTeam = addTeam(david);
    const trevor = addUser("Trevor Test", null);
    addMember(ryansTeam, trevor);
    addMember(davidsTeam, trevor, "AGENT", { goldmineBlocked: true });
    trevor.defaultOrganizationId = davidsTeam.id;
    const r = await joinUplineTeam(trevor.id, "RYAN7K");
    expect(r).toMatchObject({ status: "already-member", left: ["David Test's Team"] });
    expect(mems.filter((m) => m.userId === trevor.id).map((m) => m.organizationId)).toEqual([ryansTeam.id]);
    expect(trevor.defaultOrganizationId).toBe(ryansTeam.id);
  });

  it("creates the upline's own team when they don't have one", async () => {
    const solo = addUser("Solo Upline", "SOLO4P");
    addMember(ryansTeam, solo); // only ever joined Ryan's team
    solo.defaultOrganizationId = ryansTeam.id;
    const recruit = addUser("Recruit Agent", null);
    const r = await joinUplineTeam(recruit.id, "SOLO4P");
    expect(r.status).toBe("joined");
    const team = orgs.find((o) => o.ownerId === solo.id)!;
    expect(team.name).toBe("Solo's Team");
    expect(mems.find((m) => m.userId === recruit.id)?.organizationId).toBe(team.id);
    expect(solo.defaultOrganizationId).toBe(ryansTeam.id); // their active team is untouched
  });
});

describe("POST /api/team/leave", () => {
  it("an agent leaves a team and switches back to their own", async () => {
    const agent = addUser("Agent Test", null);
    const own = addTeam(agent);
    addMember(ryansTeam, agent, "AGENT", { goldmineBlocked: true });
    agent.defaultOrganizationId = ryansTeam.id;
    ords.push({ id: "ord_a", userId: agent.id, organizationId: ryansTeam.id });
    sessionUserId = agent.id;
    const res = await leave(jsonReq("https://advertisely.io/api/team/leave", { organizationId: ryansTeam.id }));
    expect(res.status).toBe(200);
    expect(mems.some((m) => m.userId === agent.id && m.organizationId === ryansTeam.id)).toBe(false);
    expect(agent.defaultOrganizationId).toBe(own.id);
    expect(ords[0].organizationId).toBe(own.id);
  });

  it("an owner can't leave their own team, and you can't leave a team you're not on", async () => {
    sessionUserId = ryan.id;
    expect((await leave(jsonReq("https://advertisely.io/api/team/leave", { organizationId: ryansTeam.id }))).status).toBe(400);
    expect((await leave(jsonReq("https://advertisely.io/api/team/leave", { organizationId: "org_nope" }))).status).toBe(404);
    expect(mems.some((m) => m.userId === ryan.id && m.organizationId === ryansTeam.id)).toBe(true);
  });
});

describe("POST /api/auth/register with an upline code", () => {
  const base = { name: "Jordan Pace", email: "jordan@example.test", phone: "(512) 555-0100", password: "longenough1" };

  it("creates the account and joins the upline's team", async () => {
    const res = await register(jsonReq("https://advertisely.io/api/auth/register", { ...base, uplineCode: "ryan7k" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ ok: true, joinedTeam: true, uplineTeam: ryansTeam.name });
    const u = users.find((x) => x.email === base.email)!;
    expect(mems.find((m) => m.userId === u.id)).toMatchObject({ organizationId: ryansTeam.id, inRotation: false, goldmineBlocked: false });
  });

  it("rejects an unknown code without creating the account", async () => {
    const res = await register(jsonReq("https://advertisely.io/api/auth/register", { ...base, uplineCode: "BADCODE1" }));
    expect(res.status).toBe(400);
    expect(users.find((x) => x.email === base.email)).toBeUndefined();
  });

  it("works without a code (no team join)", async () => {
    const res = await register(jsonReq("https://advertisely.io/api/auth/register", base));
    expect(await res.json()).toMatchObject({ ok: true, joinedTeam: false, uplineTeam: null });
  });
});

describe("GET /api/team/code", () => {
  it("returns the upline's first name and team only", async () => {
    const res = await lookup(new Request("https://advertisely.io/api/team/code?code=RYAN7K", { headers: { "x-real-ip": "203.0.113.9" } }) as any);
    const body = await res.json();
    expect(body).toEqual({ valid: true, code: "RYAN7K", uplineFirstName: "Ryan", teamName: ryansTeam.name });
  });
  it("says invalid for unknown codes", async () => {
    const res = await lookup(new Request("https://advertisely.io/api/team/code?code=NOPE", { headers: { "x-real-ip": "203.0.113.9" } }) as any);
    expect((await res.json()).valid).toBe(false);
  });
});

describe("POST /api/team/join (existing accounts)", () => {
  it("needs a session", async () => {
    expect((await join(jsonReq("https://advertisely.io/api/team/join", { code: "RYAN7K" }))).status).toBe(401);
  });
  it("joins with a valid code, rejects bad and own codes", async () => {
    const agent = addUser("Existing Agent", "EXIST3");
    addTeam(agent);
    sessionUserId = agent.id;
    expect((await join(jsonReq("https://advertisely.io/api/team/join", { code: "NOPE77" }))).status).toBe(404);
    expect((await join(jsonReq("https://advertisely.io/api/team/join", { code: "EXIST3" }))).status).toBe(400);
    const ok = await join(jsonReq("https://advertisely.io/api/team/join", { code: "RYAN7K" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: "joined", teamName: ryansTeam.name });
    expect(agent.defaultOrganizationId).toBe(ryansTeam.id);
  });
});

describe("Goldmine access", () => {
  it("a joiner works the Goldmine right away; a manager can switch it off and back on; agents can't", async () => {
    const newbie = addUser("New Agent", null);
    await joinUplineTeam(newbie.id, "RYAN7K");
    const m = mems.find((x) => x.userId === newbie.id)!;
    const goldLead = { assignedUserId: null, organizationId: ryansTeam.id, pipeline: "goldmine" };
    expect(await canActOnLead(newbie.id, false, goldLead)).toBe(true);

    const peer = addUser("Peer Agent", null);
    addMember(ryansTeam, peer);
    peer.defaultOrganizationId = ryansTeam.id;
    sessionUserId = peer.id;
    const denied = await patchMember(jsonReq(`https://advertisely.io/api/team/members/${m.id}`, { goldmineAccess: false }, "PATCH"), { params: { id: m.id } });
    expect(denied.status).toBe(403);

    sessionUserId = ryan.id;
    const off = await patchMember(jsonReq(`https://advertisely.io/api/team/members/${m.id}`, { goldmineAccess: false }, "PATCH"), { params: { id: m.id } });
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ membership: { goldmineAccess: false, inRotation: false } });
    expect(await canActOnLead(newbie.id, false, goldLead)).toBe(false);

    await patchMember(jsonReq(`https://advertisely.io/api/team/members/${m.id}`, { goldmineAccess: true }, "PATCH"), { params: { id: m.id } });
    expect(await canActOnLead(newbie.id, false, goldLead)).toBe(true);
  });

  it("round robin stays a manual step for the upline", async () => {
    const newbie = addUser("New Agent", null);
    await joinUplineTeam(newbie.id, "RYAN7K");
    const m = mems.find((x) => x.userId === newbie.id)!;
    expect(m.inRotation).toBe(false);
    sessionUserId = ryan.id;
    await patchMember(jsonReq(`https://advertisely.io/api/team/members/${m.id}`, { inRotation: true }, "PATCH"), { params: { id: m.id } });
    expect(m.inRotation).toBe(true);
  });

  it("making an agent an admin turns their Goldmine back on", async () => {
    const newbie = addUser("New Agent", null);
    await joinUplineTeam(newbie.id, "RYAN7K");
    const m = mems.find((x) => x.userId === newbie.id)!;
    m.goldmineBlocked = true;
    sessionUserId = ryan.id;
    await patchMember(jsonReq(`https://advertisely.io/api/team/members/${m.id}`, { role: "ADMIN" }, "PATCH"), { params: { id: m.id } });
    expect(m).toMatchObject({ role: "ADMIN", goldmineBlocked: false });
  });
});

