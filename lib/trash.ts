import { prisma } from "./prisma";

/**
 * Recycle-bin retention. A lead with `trashedAt` set is "in the trash":
 *  - excluded from every sellable / fulfillment query (see lib/inventory.ts,
 *    lib/fulfillment.ts, app/api/inventory) so it can never be delivered/sold,
 *  - hard-deleted this many days after it was trashed by the auto-empty job.
 */
export const TRASH_RETENTION_DAYS = 30;

/**
 * Permanently delete leads that have been in the trash longer than the
 * retention window. Mirrors the manual delete route's related-row cleanup.
 * Does NOT adjust order fulfilledCount: trashed leads are already-replaced
 * (offset by their replacement), so deleting them must not reduce a buyer's
 * delivered-good count. Returns the number of leads purged.
 */
export async function emptyTrash(olderThanDays = TRASH_RETENTION_DAYS): Promise<number> {
  if (!prisma) return 0;
  const db = prisma;
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);

  const doomed = await db.lead.findMany({
    where: { trashedAt: { not: null, lt: cutoff } },
    select: { id: true },
  });
  const ids = doomed.map((d) => d.id);
  if (ids.length === 0) return 0;

  await db.$transaction([
    db.leadActivity.deleteMany({ where: { leadId: { in: ids } } }),
    db.leadNote.deleteMany({ where: { leadId: { in: ids } } }),
    db.task.deleteMany({ where: { leadId: { in: ids } } }),
    db.replacementRequest.deleteMany({ where: { leadId: { in: ids } } }),
    db.lead.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return ids.length;
}
