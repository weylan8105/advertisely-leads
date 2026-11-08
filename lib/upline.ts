import { prisma } from "@/lib/prisma";
import { normalizeCode } from "@/lib/referralPricing";
import { canManageTeam, ensureOwnedOrganization, getOrgContext, personalOrgName, refileOwnOrders } from "@/lib/org";
import { isEmailConfigured, sendUplineJoinEmail } from "@/lib/email";

/**
 * Upline codes. An agent's Advertisely code (User.referralCode, the same code
 * that takes 10% off at checkout) also puts a new agent on that person's team:
 * entered at signup ("Do you have an upline?") or later on the Team page.
 *
 * The code joins the team its owner runs: their active team when they manage it
 * (OWNER/ADMIN), else the team they own (created on first use). Because these
 * codes are shared publicly as discount codes, there's no approval step: the
 * agent is on the team right away with the team's Goldmine (a manager can switch
 * that off per member), but out of round-robin rotation until a manager puts
 * them in it on the Team page. Someone on the wrong team just enters the right
 * upline's code.
 *
 * An agent has one upline at a time: joining a new upline's team is a transfer
 * that takes them off any other team where they're an agent (their own team,
 * and teams they help run as an admin, stay). Their leads stay in their CRM,
 * and lead orders they bought move to the new team.
 */

export interface UplineTeam {
  code: string;
  uplineUserId: string;
  uplineName: string | null;
  /** null = the upline doesn't own a team yet; one is created on the first join. */
  organizationId: string | null;
  teamName: string;
}

export type JoinResult =
  | { status: "joined"; organizationId: string; teamName: string; uplineName: string | null; left: string[] }
  | { status: "already-member"; organizationId: string; teamName: string; uplineName: string | null; left: string[] }
  | { status: "own-code" }
  | { status: "invalid" };

/** The team a user's code recruits into: their active team if they manage it, else the team they own. */
export async function uplineTeamFor(userId: string): Promise<{ id: string; name: string } | null> {
  if (!prisma) return null;
  const ctx = await getOrgContext(userId);
  if (ctx && canManageTeam(ctx.role)) return { id: ctx.organizationId, name: ctx.organizationName };
  return prisma.organization.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
}

/** Look up an upline code. Null when no account has it. */
export async function resolveUplineCode(raw: unknown): Promise<UplineTeam | null> {
  if (!prisma || typeof raw !== "string") return null;
  const code = normalizeCode(raw);
  if (!code || code.length > 20) return null;
  const owner = await prisma.user.findUnique({
    where: { referralCode: code },
    select: { id: true, name: true, email: true, agency: true },
  });
  if (!owner) return null;
  const team = await uplineTeamFor(owner.id);
  return {
    code,
    uplineUserId: owner.id,
    uplineName: owner.name,
    organizationId: team?.id ?? null,
    teamName: team?.name ?? personalOrgName(owner),
  };
}

/**
 * Leave every other team where this user is an agent, so their new upline's
 * team is their only one, and bring their own lead orders with them. Returns
 * the names of the teams they left.
 */
async function leaveOtherUplineTeams(userId: string, keepOrganizationId: string): Promise<string[]> {
  if (!prisma) return [];
  const others = await prisma.membership.findMany({
    where: { userId, role: "AGENT", organizationId: { not: keepOrganizationId } },
    select: { id: true, organizationId: true, organization: { select: { name: true } } },
  });
  if (others.length === 0) return [];
  await prisma.membership.deleteMany({ where: { id: { in: others.map((m) => m.id) } } });
  await refileOwnOrders(userId, others.map((m) => m.organizationId), keepOrganizationId);
  return others.map((m) => m.organization.name);
}

/**
 * Put `userId` on the team behind an upline code (out of rotation), make it
 * their active team, and take them off any other upline's team (a transfer).
 * Already on that team → their membership there is unchanged.
 */
export async function joinUplineTeam(userId: string, raw: unknown): Promise<JoinResult> {
  if (!prisma) return { status: "invalid" };
  const up = await resolveUplineCode(raw);
  if (!up) return { status: "invalid" };
  if (up.uplineUserId === userId) return { status: "own-code" };

  const team = up.organizationId
    ? { id: up.organizationId, name: up.teamName }
    : await ensureOwnedOrganization(up.uplineUserId);
  if (!team) return { status: "invalid" };

  const already = async () => {
    const left = await leaveOtherUplineTeams(userId, team.id);
    if (left.length > 0) {
      await prisma!.user.update({ where: { id: userId }, data: { defaultOrganizationId: team.id } });
    }
    return { status: "already-member" as const, organizationId: team.id, teamName: team.name, uplineName: up.uplineName, left };
  };
  const existing = await prisma.membership.findUnique({
    where: { organizationId_userId: { organizationId: team.id, userId } },
    select: { id: true },
  });
  if (existing) return already();

  try {
    await prisma.$transaction([
      prisma.membership.create({
        data: { organizationId: team.id, userId, role: "AGENT", inRotation: false },
      }),
      prisma.user.update({ where: { id: userId }, data: { defaultOrganizationId: team.id } }),
    ]);
  } catch (e: any) {
    if (e?.code === "P2002") return already(); // joined concurrently
    throw e;
  }
  const left = await leaveOtherUplineTeams(userId, team.id);

  await notifyUplineOfJoin(team.id, up.uplineUserId, userId).catch((e) =>
    console.warn("[upline] join notification failed", e),
  );
  return { status: "joined", organizationId: team.id, teamName: team.name, uplineName: up.uplineName, left };
}

/** Email the code's owner (and the team owner, if someone else) that an agent joined their team. */
async function notifyUplineOfJoin(organizationId: string, uplineUserId: string, joinerUserId: string) {
  if (!prisma || !isEmailConfigured) return;
  const [org, joiner] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, ownerId: true } }),
    prisma.user.findUnique({ where: { id: joinerUserId }, select: { name: true, email: true } }),
  ]);
  if (!org || !joiner) return;
  const recipients = await prisma.user.findMany({
    where: { id: { in: [...new Set([uplineUserId, org.ownerId])] } },
    select: { email: true },
  });
  const teamUrl = `${process.env.NEXTAUTH_URL ?? "https://advertisely.io"}/team`;
  for (const r of recipients) {
    await sendUplineJoinEmail({
      toEmail: r.email,
      teamName: org.name,
      joinerName: joiner.name || joiner.email.split("@")[0],
      joinerEmail: joiner.email,
      teamUrl,
    });
  }
}
