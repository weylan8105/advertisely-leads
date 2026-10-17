import { prisma } from "./prisma";

/**
 * Limited rollout gate for in-CRM texting (Sendblue). Texting is available to:
 *   - platform admins, and
 *   - members of a team whose Goldmine list is enabled (i.e. the downline who
 *     have access to that admin's Goldmine).
 * Everyone else can't see or use texting yet.
 */
export async function canUseTexting(userId: string, isPlatformAdmin: boolean): Promise<boolean> {
  if (isPlatformAdmin) return true;
  if (!prisma) return false;
  const membership = await prisma.membership.findFirst({
    where: { userId, organization: { goldmineEnabled: true } },
    select: { id: true },
  });
  return !!membership;
}
