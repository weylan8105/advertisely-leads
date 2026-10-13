import { getOrgContext, canManageTeam } from "./org";

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
 */
export async function canActOnLead(
  userId: string,
  isPlatformAdmin: boolean,
  lead: LeadAccessShape,
): Promise<boolean> {
  if (isPlatformAdmin || lead.assignedUserId === userId) return true;
  if (!lead.organizationId) return false;
  const ctx = await getOrgContext(userId);
  if (!ctx || ctx.organizationId !== lead.organizationId) return false;
  if (lead.pipeline === "goldmine") return true; // shared team pool
  return canManageTeam(ctx.role);
}
