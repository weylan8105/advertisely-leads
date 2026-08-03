import { prisma } from "./prisma";

export type OrgRole = "OWNER" | "ADMIN" | "AGENT";

export interface OrgContext {
  organizationId: string;
  organizationName: string;
  role: OrgRole;
  distributionMode: "MANUAL" | "ROUND_ROBIN";
}

function personalOrgName(u: { name: string | null; email: string; agency: string | null }): string {
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
  };
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

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, agency: true },
  });
  if (!user) return null;

  const org = await prisma.organization.create({
    data: { name: personalOrgName(user), ownerId: user.id, distributionMode: "MANUAL" },
  });
  await prisma.membership.create({
    data: { organizationId: org.id, userId: user.id, role: "OWNER", inRotation: true },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { defaultOrganizationId: org.id },
  });

  return {
    organizationId: org.id,
    organizationName: org.name,
    role: "OWNER",
    distributionMode: "MANUAL",
  };
}

export function canManageTeam(role: OrgRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}
