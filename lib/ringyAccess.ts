import { prisma } from "@/lib/prisma";
import { isRingyConfigured, type RingyConfig } from "@/lib/ringy";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

/** True when this user has their own Ringy connected (an enabled RINGY integration with both keys). */
export async function hasRingy(userId: string): Promise<boolean> {
  if (!prisma) return false;
  const row = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: "RINGY" } },
    select: { enabled: true, config: true },
  });
  return !!row?.enabled && isRingyConfigured(row.config as Partial<RingyConfig> | null);
}

/**
 * May `callerId` link Ringy for their team? Anyone who has Ringy themselves and
 * manages a team (owner or team admin) can connect it for their downlines. This
 * is the per-team rule; the per-member check is canLinkRingyFor.
 */
export async function ringyLinkContext(callerId: string): Promise<{ organizationId: string } | null> {
  if (!prisma) return null;
  const ctx = await ensureOrgContext(callerId);
  if (!ctx || !canManageTeam(ctx.role)) return null;
  if (!(await hasRingy(callerId))) return null;
  return { organizationId: ctx.organizationId };
}

/**
 * May `callerId` set or remove `targetUserId`'s Ringy keys? Only for someone
 * below them on the team they manage: never the team owner, never themselves.
 */
export async function canLinkRingyFor(callerId: string, targetUserId: string): Promise<boolean> {
  if (!prisma || !targetUserId || targetUserId === callerId) return false;
  const team = await ringyLinkContext(callerId);
  if (!team) return false;
  const m = await prisma.membership.findFirst({
    where: { organizationId: team.organizationId, userId: targetUserId },
    select: { role: true },
  });
  return !!m && m.role !== "OWNER";
}

/** A clearly fake lead (reserved 555-01xx number) to check someone's Ringy keys. */
export const RINGY_TEST_LEAD = {
  name: "Advertisely Test Lead (delete me)",
  phone: "5555550100",
  email: "test@advertisely.io",
  state: "TX",
  age: 45,
  occupation: "Test lead from Advertisely, please delete",
  // Shaped like a real GoHighLevel lead: no numeric income, answers under
  // " (old)"-suffixed question names, multi-selects as JSON-array strings.
  income: null as number | null,
  rawFormData: {
    "What's your current household income? (old)": "$75,000 – $125,000",
    "When would you ideally like to retire? (old)": '["By 55"]',
    "How much could you comfortably put towards building your tax-free retirement each month? (old)": "$500 – $1,000",
  },
};

/**
 * May `callerId` manage `targetUserId`'s Ringy (connect, unlink, send a test
 * lead)? Themselves, a site admin, or an upline who can link it for them.
 */
export async function canManageRingyOf(callerId: string, targetUserId: string, callerRole?: string): Promise<boolean> {
  if (!targetUserId) return false;
  if (callerId === targetUserId || callerRole === "ADMIN") return true;
  return canLinkRingyFor(callerId, targetUserId);
}
