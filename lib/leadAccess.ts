import { prisma } from "./prisma";
import { canManageTeam, type OrgRole } from "./org";

export interface LeadAccessShape {
  assignedUserId: string | null;
  organizationId: string | null;
  pipeline?: string | null;
}

/**
 * Can this user act on (move / text / note / schedule) this lead?
 *  - platform admin, or the assigned agent → always
 *  - a **Goldmine** lead → ANY member of the lead's org (shared team pool)
 *  - a **main**-pipeline lead → only a manager (OWNER/ADMIN) of the lead's org
 *
 * Team membership is checked against the LEAD's org directly (not the caller's
 * default team), so an agent on several teams never loses access to a team's
 * Goldmine just because their default team is a different one.
 */
export async function canActOnLead(
  userId: string,
  isPlatformAdmin: boolean,
  lead: LeadAccessShape,
): Promise<boolean> {
  if (isPlatformAdmin || lead.assignedUserId === userId) return true;
  if (!lead.organizationId || !prisma) return false;
  const membership = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: lead.organizationId, userId } },
    select: { role: true },
  });
  if (!membership) return false;
  if (lead.pipeline === "goldmine") return true; // shared team pool
  return canManageTeam(membership.role as OrgRole);
}
