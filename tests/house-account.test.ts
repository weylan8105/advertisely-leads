import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * getHouseAccount picks Ryan's account, not whichever admin signed up first.
 * Mocked prisma with SYNTHETIC data; never touches a real DB.
 */

const prismaMock = { user: { findFirst: vi.fn() } };
vi.mock("@/lib/prisma", () => ({
  isDatabaseConfigured: true,
  get prisma() { return prismaMock; },
}));

import { getHouseAccount } from "@/lib/house";

const ryan = { id: "ryan", ownedOrganizations: [{ id: "ryans-team" }] };
const oldestAdmin = { id: "first-admin", ownedOrganizations: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getHouseAccount", () => {
  it("is Ryan's account and team even when another admin signed up first", async () => {
    prismaMock.user.findFirst.mockImplementation(async ({ where }: any) => (where.email ? ryan : oldestAdmin));
    expect(await getHouseAccount()).toEqual({ userId: "ryan", organizationId: "ryans-team" });
    expect(prismaMock.user.findFirst.mock.calls[0][0].where).toEqual({
      role: "ADMIN",
      email: { equals: "ryanrush129@gmail.com", mode: "insensitive" },
    });
  });

  it("falls back to the oldest admin when that account isn't an admin", async () => {
    prismaMock.user.findFirst.mockImplementation(async ({ where }: any) => (where.email ? null : oldestAdmin));
    expect(await getHouseAccount()).toEqual({ userId: "first-admin", organizationId: null });
    expect(prismaMock.user.findFirst.mock.calls[1][0]).toMatchObject({ where: { role: "ADMIN" }, orderBy: { createdAt: "asc" } });
  });

  it("is null with no admins", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    expect(await getHouseAccount()).toBeNull();
  });
});
