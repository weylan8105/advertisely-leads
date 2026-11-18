import { prisma } from "./prisma";
import { INTAKE_STAGE_ID } from "@/data/pipeline";

/**
 * Where a team owner's incoming leads land (Organization.leadDestination),
 * chosen on their dashboard (owner request, Nov 18 2026; replaces round robin
 * and weekly amounts):
 *  - PERSONAL: every lead goes to the owner's own pipeline.
 *  - SPLIT: leads alternate, one to the owner's pipeline, the next to the
 *    team's Goldmine.
 *  - GOLDMINE: every lead goes to the team's Goldmine.
 * A Goldmine lead stays owned by the owner (assignedUserId) and sits in the
 * team's shared Goldmine pipeline for members with Goldmine access to work.
 * Applies to the owner's campaign leads, overflow and house leads, and their
 * own lead orders, never to an order bought for a downline or a lead a
 * downline paid for. With nobody else on the team who can work the Goldmine,
 * every lead stays in the owner's pipeline.
 */

export type LeadDestination = "PERSONAL" | "SPLIT" | "GOLDMINE";
export type LeadPipeline = "main" | "goldmine";

export const LEAD_DESTINATIONS: LeadDestination[] = ["PERSONAL", "SPLIT", "GOLDMINE"];
export const isLeadDestination = (v: unknown): v is LeadDestination =>
  typeof v === "string" && (LEAD_DESTINATIONS as string[]).includes(v);

/** The fields that put a lead into a team's Goldmine. */
export function goldmineLeadData(organizationId: string, now: Date) {
  return {
    pipeline: "goldmine",
    goldmineAt: now,
    pipelineStage: INTAKE_STAGE_ID,
    organizationId,
    workingUserId: null,
  };
}

/** Pure: which pipeline each of `count` leads goes to, given the cursor before them. */
export function pipelinesFor(destination: LeadDestination, cursorBefore: number, count: number): LeadPipeline[] {
  return Array.from({ length: count }, (_, i) => {
    if (destination === "GOLDMINE") return "goldmine";
    if (destination === "SPLIT") return (cursorBefore + i) % 2 === 0 ? "main" : "goldmine";
    return "main";
  });
}

/**
 * The pipeline for each of the next `count` leads arriving for this owner in
 * this team. Advances the SPLIT alternation. All "main" unless the team is the
 * owner's own and someone else on it can work the Goldmine.
 */
export async function planLeadPipelines(
  organizationId: string | null | undefined,
  ownerId: string,
  count = 1,
): Promise<LeadPipeline[]> {
  const personal = Array.from({ length: count }, (): LeadPipeline => "main");
  if (!prisma || !organizationId || count <= 0) return personal;
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ownerId: true, leadDestination: true },
  });
  if (!org || org.ownerId !== ownerId || org.leadDestination === "PERSONAL") return personal;
  const workers = await prisma.membership.count({
    where: { organizationId, userId: { not: ownerId }, goldmineBlocked: false },
  });
  if (workers === 0) return personal;
  if (org.leadDestination === "GOLDMINE") return pipelinesFor("GOLDMINE", 0, count);
  // Atomic, so two leads arriving at once don't both take the same turn.
  const { rrCursor } = await prisma.organization.update({
    where: { id: organizationId },
    data: { rrCursor: { increment: count } },
    select: { rrCursor: true },
  });
  return pipelinesFor("SPLIT", rrCursor - count, count);
}

/** One lead's pipeline. */
export async function nextLeadPipeline(organizationId: string | null | undefined, ownerId: string): Promise<LeadPipeline> {
  return (await planLeadPipelines(organizationId, ownerId, 1))[0];
}
