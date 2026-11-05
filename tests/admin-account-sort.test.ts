import { describe, it, expect } from "vitest";
import { compareAccounts, hasOpenOrder } from "@/lib/adminAccountSort";

const account = (name: string, o: Partial<Parameters<typeof hasOpenOrder>[0]> = {}) => ({
  name,
  orderedQty: 0,
  subscription: null,
  delivered: 0,
  joinedAt: "2026-10-01",
  ...o,
});

describe("compareAccounts", () => {
  it("puts open orders and subscriptions above accounts with more leads", () => {
    const sorted = [
      account("past buyer", { delivered: 500 }),
      account("open order", { orderedQty: 25, delivered: 3 }),
      account("subscriber", { subscription: { status: "active" }, delivered: 10 }),
    ].sort(compareAccounts);
    expect(sorted.map((a) => a.name)).toEqual(["subscriber", "open order", "past buyer"]);
  });

  it("keeps accounts with no orders at the bottom, newest signup first", () => {
    const sorted = [
      account("older signup", { joinedAt: "2026-10-01" }),
      account("past buyer", { delivered: 40 }),
      account("newer signup", { joinedAt: "2026-11-03" }),
    ].sort(compareAccounts);
    expect(sorted.map((a) => a.name)).toEqual(["past buyer", "newer signup", "older signup"]);
  });
});
