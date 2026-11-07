import { prisma } from "./prisma";

export type OrgRole = "OWNER" | "ADMIN" | "AGENT";

export interface OrgContext {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
  distributionMode: "MANUAL" | "ROUND_ROBIN" | "WEEKLY_QUOTA";
  // Joined with an upline code and awaiting a manager's approval (see lib/upline.ts).
  pending: boolean;
}

export function personalOrgName(u: { name: string | null; email: string; agency: string | null }): string {
  if (u.agency && u.agency.trim()) return u.agency.trim();
  const base = (u.name && u.name.trim()) || u.email.split("@")[0] || "My";
  return `${base.split(/\s+/)[0]}'s Team`;
}

/**
 * Resolve the caller's active organization + their role in it. Read-only:
 * returns null if the user somehow has no membership (use ensureOrgContext to
 * auto-provision one).
 */
export async function getOrgContext(userId: string): Promise<OrgContext | null> {
  if (!prisma) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { defaultOrganizationId: true },
  });

  let membership =
    user?.defaultOrganizationId
      ? await prisma.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: user.defaultOrganizationId,
              userId,
            },
          },
          include: { organization: { select: { id: true, name: true, distributionMode: true } } },
        })
      : null;

  if (!membership) {
    membership = await prisma.membership.findFirst({
      where: { userId },
      include: { organization: { select: { id: true, name: true, distributionMode: true } } },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!membership) return null;
  return {
    organizationId: membership.organization.id,
    organizationName: membership.organization.name,
    role: membership.role as OrgRole,
    distributionMode: membership.organization.distributionMode as OrgContext["distributionMode"],
    pending: membership.pendingApproval,
  };
}

/**
 * The user's owned team, creating their personal one if they own none. A new
 * user's first page load fires several API calls at once, and each used to see
 * no team and create its own, so the check and create run under a per-user lock.
 */
async function provisionOwnedTeam(userId: string): Promise<{ id: string; name: string } | null> {
  if (!prisma) return null;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
    const owned = await tx.organization.findFirst({
      where: { ownerId: userId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    if (owned) return owned;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, agency: true, defaultOrganizationId: true },
    });
    if (!user) return null;
    const org = await tx.organization.create({
      data: { name: personalOrgName(user), ownerId: user.id, distributionMode: "MANUAL" },
      select: { id: true, name: true },
    });
    await tx.membership.create({
      data: { organizationId: org.id, userId: user.id, role: "OWNER", inRotation: true },
    });
    if (!user.defaultOrganizationId) {
      await tx.user.update({ where: { id: user.id }, data: { defaultOrganizationId: org.id } });
    }
    return org;
  });
}

/**
 * Like getOrgContext but provisions a personal organization for the user if
 * they don't have one yet (new signups after the Phase 1 migration). Every
 * user is the OWNER of their own team by default.
 */
export async function ensureOrgContext(userId: string): Promise<OrgContext | null> {
  if (!prisma) return null;
  const existing = await getOrgContext(userId);
  if (existing) return existing;
  return (await provisionOwnedTeam(userId)) ? getOrgContext(userId) : null;
}

/**
 * The team this user owns, creating their personal one if they own none (e.g.
 * they signed up straight into someone else's team). Doesn't switch their
 * active team unless they have none yet.
 */
export async function ensureOwnedOrganization(userId: string): Promise<{ id: string; name: string } | null> {
  if (!prisma) return null;
  const owned = await prisma.organization.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  return owned ?? provisionOwnedTeam(userId);
}

/**
 * The team an owner's campaign leads run through: their active team when they
 * own it, else their oldest. Some accounts own empty duplicates (see
 * provisionOwnedTeam), so the oldest isn't always the one with their agents.
 */
export function primaryOwnedTeam<T extends { id: string }>(
  owned: T[],
  defaultOrganizationId: string | null | undefined,
): T | undefined {
  return owned.find((o) => o.id === defaultOrganizationId) ?? owned[0];
}

/**
 * Move a user's own lead orders (and those orders' leads still on the main
 * board) from teams they've left to the team they're on now. An agent's
 * purchases are filed under whatever team was active when they bought, so
 * without this a transfer would leave their old upline managing leads they
 * paid for, and they couldn't route them to their own agents.
 */
export async function refileOwnOrders(userId: string, fromOrganizationIds: string[], toOrganizationId: string) {
  if (!prisma || fromOrganizationIds.length === 0) return;
  const orders = await prisma.order.findMany({
    where: { userId, organizationId: { in: fromOrganizationIds } },
    select: { id: true },
  });
  if (orders.length === 0) return;
  const ids = orders.map((o) => o.id);
  await prisma.$transaction([
    prisma.order.updateMany({ where: { id: { in: ids } }, data: { organizationId: toOrganizationId } }),
    prisma.lead.updateMany({
      where: { orderId: { in: ids }, organizationId: { in: fromOrganizationIds }, pipeline: "main" },
      data: { organizationId: toOrganizationId },
    }),
  ]);
}

export function canManageTeam(role: OrgRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
