import { describe, it, expect } from "vitest";
import { fewestFirstOrder } from "@/lib/fewestFirst";

const counts = (o: Record<string, number>) => new Map(Object.entries(o));

describe("fewest first", () => {
  it("offers the lead to whoever has had the fewest leads, not whoever is next in line", () => {
    // Jace is next in this state's line but has had 13; Ronny has had 2.
    const order = fewestFirstOrder(["jace", "daniel", "ronny", "gloria"], counts({ jace: 13, daniel: 10, ronny: 2, gloria: 3 }));
    expect(order).toEqual(["ronny", "gloria", "daniel", "jace"]);
  });

  it("keeps the turn order among people level on leads", () => {
    const order = fewestFirstOrder(["c", "a", "b"], counts({ a: 4, b: 4, c: 4 }));
    expect(order).toEqual(["c", "a", "b"]);
    // A tie for fewest: the one earlier in the turn order goes first.
    expect(fewestFirstOrder(["x", "y", "z"], counts({ x: 5, y: 1, z: 1 }))).toEqual(["y", "z", "x"]);
  });

  it("counts someone with no leads in the window as zero, so a new client is first", () => {
    expect(fewestFirstOrder(["old", "new"], counts({ old: 3 }))).toEqual(["new", "old"]);
  });

  it("treats the admins' turn like everyone else's: neither first nor last", () => {
    const order = fewestFirstOrder(["client1", "ryan", "client2"], counts({ client1: 9, ryan: 6, client2: 2 }));
    expect(order).toEqual(["client2", "ryan", "client1"]);
  });

  it("is the plain turn order when the counts can't be read", () => {
    expect(fewestFirstOrder(["b", "c", "a"], new Map())).toEqual(["b", "c", "a"]);
  });

  it("evens people out over a run of leads", () => {
    // Twelve leads everyone could take; one person starts far ahead.
    const got = counts({ many: 8, few: 0, mid: 3 });
    const line = ["many", "few", "mid"];
    let last = -1;
    for (let i = 0; i < 12; i++) {
      const turnOrder = line.map((_, s) => line[(last + 1 + s) % line.length]);
      const winner = fewestFirstOrder(turnOrder, got)[0];
      got.set(winner, (got.get(winner) ?? 0) + 1);
      last = line.indexOf(winner);
    }
    // 11 + 12 = 23 leads between three people: as level as it can be.
    expect([got.get("many"), got.get("few"), got.get("mid")].sort((a, b) => a! - b!)).toEqual([7, 8, 8]);
  });
});
