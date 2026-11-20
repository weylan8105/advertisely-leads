import { prisma } from "./prisma";
import { sendGoldmineLeadAlertEmail, isEmailConfigured } from "./email";

/**
 * A brand-new lead just landed in a team's Goldmine: email every agent with
 * Goldmine access on that team so someone calls within minutes (the first to
 * call takes it). Goldmine leads otherwise get no delivery email, because they
 * aren't in anyone's own pipeline.
 *
 * The email goes to our own users only, never the lead, and carries just the
 * lead's first name and state. Turn off with GOLDMINE_LEAD_ALERTS=0. Never throws.
 */
export async function alertGoldmineTeamOfNewLead(leadId: string, now = new Date()): Promise<number> {
  try {
    if (!prisma || !isEmailConfigured || process.env.GOLDMINE_LEAD_ALERTS === "0") return 0;
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { name: true, state: true, pipeline: true, goldmineAt: true, organizationId: true, assignedUserId: true },
    });
    // Only a lead that went straight into Goldmine just now, not an aged one swept in later.
    if (!lead || lead.pipeline !== "goldmine" || !lead.organizationId || !isFreshGoldmine(lead.goldmineAt, now)) return 0;

    const org = await prisma.organization.findUnique({
      where: { id: lead.organizationId },
      select: {
        name: true,
        ownerId: true,
        goldmineEnabled: true,
        memberships: { where: { goldmineBlocked: false }, select: { userId: true } },
      },
    });
    if (!org?.goldmineEnabled) return 0;
    const owner = await prisma.user.findUnique({ where: { id: org.ownerId }, select: { agency: true, name: true } });
    const teamName = owner?.agency?.trim() || org.name;

    const ids = [...new Set([org.ownerId, ...org.memberships.map((m) => m.userId)])];
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { email: true, name: true } });
    let sent = 0;
    for (const u of users) {
      if (!u.email) continue;
      const r = await sendGoldmineLeadAlertEmail({
        toEmail: u.email,
        agentName: firstWord(u.name) || "there",
        teamName,
        leadFirstName: firstWord(lead.name),
        leadState: lead.state,
      }).catch(() => ({ success: false }));
      if (r.success) sent++;
    }
    return sent;
  } catch (e) {
    console.warn("[goldmine-alert] failed for lead", leadId, (e as Error).message);
    return 0;
  }
}

/** Landed in Goldmine within the last 10 minutes. */
export function isFreshGoldmine(goldmineAt: Date | null | undefined, now = new Date()): boolean {
  return !!goldmineAt && now.getTime() - new Date(goldmineAt).getTime() <= 10 * 60_000;
}

const firstWord = (s: string | null | undefined) => (s || "").trim().split(/\s+/)[0] || "";
