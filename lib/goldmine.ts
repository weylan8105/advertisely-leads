// Goldmine auto-move: flip a team owner's aged main-pipeline leads into the
// shared Goldmine pool. Driven by a daily cron (/api/cron/goldmine-sweep).
//
// Rules (owner directive): only the OWNER's own leads move; a lead moves once
// it's older than the team's threshold (default 30 days, adjustable), measured
// from when it was assigned; SOLD leads (the won stage) never move.

import { prisma } from "./prisma";
import { INTAKE_STAGE_ID, WON_STAGE_ID } from "@/data/pipeline";

/** Default days-until-Goldmine when a team hasn't set its own value. */
export const GOLDMINE_DEFAULT_DAYS = 30;

const DAY_MS = 86_400_000;

export async function sweepGoldmine(): Promise<{ moved: number; orgs: number }> {
  if (!prisma) return { moved: 0, orgs: 0 };

  const orgs = await prisma.organization.findMany({
    where: { goldmineEnabled: true },
    select: { id: true, ownerId: true, goldmineAfterDays: true },
  });

  const now = new Date();
  let moved = 0;

  for (const org of orgs) {
    const days = org.goldmineAfterDays ?? GOLDMINE_DEFAULT_DAYS;
    const cutoff = new Date(now.getTime() - days * DAY_MS);

    // The owner's aged, un-sold, main-pipeline leads for this team.
    const candidates = await prisma.lead.findMany({
      where: {
        assignedUserId: org.ownerId,
        organizationId: org.id,
        pipeline: "main",
        trashedAt: null,
        pipelineStage: { not: WON_STAGE_ID },
        assignedAt: { lte: cutoff }, // nulls don't satisfy lte, so they're excluded
      },
      select: { id: true },
      take: 1000,
    });
    if (candidates.length === 0) continue;

    const ids = candidates.map((c) => c.id);
    await prisma.lead.updateMany({
      where: { id: { in: ids } },
      // Start fresh at the Goldmine intake stage so the team works them anew.
      data: { pipeline: "goldmine", goldmineAt: now, pipelineStage: INTAKE_STAGE_ID },
    });
    await prisma.leadActivity.createMany({
      data: ids.map((leadId) => ({
        leadId,
        type: "STATUS_CHANGED" as const,
        body: `Auto-moved to Goldmine (aged ${days}+ days).`,
      })),
    });
    moved += ids.length;
  }

  return { moved, orgs: orgs.length };
}
