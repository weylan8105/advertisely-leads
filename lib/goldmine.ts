// Goldmine auto-move: flip a team owner's aged main-pipeline leads into the
// shared Goldmine pool. Driven by a daily cron (/api/cron/goldmine-sweep).
//
// Rules (owner directive): only the OWNER's own leads move; a lead moves once
// it's older than the team's threshold (default 30 days, adjustable), measured
// from when it was assigned; only New Lead / Dialed / Contacted / Call Back leads
// move, and never one with an upcoming callback.
//
// Runs daily from the cron, and also (throttled) whenever a team member loads
// their pipeline or the Goldmine, so leads move as soon as they age out rather
// than waiting for the nightly run.

import { prisma } from "./prisma";
import { INTAKE_STAGE_ID, GOLDMINE_ELIGIBLE_STAGE_IDS } from "@/data/pipeline";

/** Default days-until-Goldmine when a team hasn't set its own value. */
export const GOLDMINE_DEFAULT_DAYS = 30;

const DAY_MS = 86_400_000;

type SweepOrg = { id: string; ownerId: string; goldmineAfterDays: number | null };

export async function sweepGoldmine(): Promise<{ moved: number; orgs: number }> {
  if (!prisma) return { moved: 0, orgs: 0 };

  const orgs = await prisma.organization.findMany({
    where: { goldmineEnabled: true },
    select: { id: true, ownerId: true, goldmineAfterDays: true },
  });

  let moved = 0;
  for (const org of orgs) moved += await sweepOrg(org, new Date());
  return { moved, orgs: orgs.length };
}

// Page-load sweeps run at most this often per team (per server instance).
const PAGE_SWEEP_MS = 2 * 60_000;
const lastPageSweep = new Map<string, number>();

/**
 * Sweep one team's aged leads now (called when a member loads their pipeline or
 * the Goldmine). Throttled, and never throws — a failed sweep must not break the
 * page; the nightly cron is the backstop.
 */
export async function sweepGoldmineForOrg(organizationId: string | null | undefined): Promise<number> {
  if (!prisma || !organizationId) return 0;
  const last = lastPageSweep.get(organizationId) ?? 0;
  if (Date.now() - last < PAGE_SWEEP_MS) return 0;
  lastPageSweep.set(organizationId, Date.now());
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, ownerId: true, goldmineAfterDays: true, goldmineEnabled: true },
    });
    if (!org?.goldmineEnabled) return 0;
    return await sweepOrg(org, new Date());
  } catch (e) {
    console.error("[goldmine] page-load sweep failed", e);
    return 0;
  }
}

async function sweepOrg(org: SweepOrg, now: Date): Promise<number> {
  if (!prisma) return 0;
  const days = org.goldmineAfterDays ?? GOLDMINE_DEFAULT_DAYS;
  const cutoff = new Date(now.getTime() - days * DAY_MS);

  // The owner's aged, un-sold, main-pipeline leads for this team.
  const candidates = await prisma.lead.findMany({
    where: {
      assignedUserId: org.ownerId,
      // The owner's own leads in this team — plus any of theirs never stamped
      // with a team (older imports), which the move adopts into this team.
      OR: [{ organizationId: org.id }, { organizationId: null }],
      pipeline: "main",
      trashedAt: null,
      // Only New Lead / Dialed / Contacted / Call Back — never live deals or DNC.
      pipelineStage: { in: [...GOLDMINE_ELIGIBLE_STAGE_IDS] },
      // A lead with an upcoming callback stays with its owner until it passes.
      AND: [{ OR: [{ callbackAt: null }, { callbackAt: { lte: now } }] }],
      assignedAt: { lte: cutoff }, // nulls don't satisfy lte, so they're excluded
    },
    select: { id: true },
    take: 1000,
  });
  if (candidates.length === 0) return 0;

  const ids = candidates.map((c) => c.id);
  await prisma.lead.updateMany({
    where: { id: { in: ids } },
    // Start fresh at the Goldmine intake stage so the team works them anew.
    data: { pipeline: "goldmine", goldmineAt: now, pipelineStage: INTAKE_STAGE_ID, organizationId: org.id, workingUserId: null },
  });
  await prisma.leadActivity.createMany({
    data: ids.map((leadId) => ({
      leadId,
      type: "STATUS_CHANGED" as const,
      body: `Auto-moved to Goldmine (aged ${days}+ days).`,
    })),
  });
  return ids.length;
}
