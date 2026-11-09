import type { Lead } from "@/types";

/**
 * Live refresh for shared boards (Goldmine). The server sends only the leads that
 * changed plus the ids of every lead still on the board; this folds that into what
 * the viewer already has.
 *
 * A lead the viewer changed themselves in the last `graceMs` keeps its local copy:
 * their save may not have landed yet, and the server's older copy would make the
 * card jump back for a moment.
 */
export function mergeLeadDelta(
  current: Lead[],
  changed: Lead[],
  ids: string[],
  touchedAt: ReadonlyMap<string, number>,
  now: number,
  graceMs: number,
): { leads: Lead[]; missing: boolean } {
  const recent = (id: string) => now - (touchedAt.get(id) ?? -Infinity) < graceMs;
  const byId = new Map(current.map((l) => [l.id, l]));
  for (const l of changed) if (!recent(l.id)) byId.set(l.id, l);

  const onBoard = new Set(ids);
  const leads = [...byId.values()].filter((l) => onBoard.has(l.id) || recent(l.id));
  leads.sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));

  // A lead the server lists that we have no copy of (and didn't just remove
  // ourselves): only a full reload can fill it in.
  const missing = ids.some((id) => !byId.has(id) && !recent(id));
  return { leads, missing };
}

/** Ids whose card changed between two versions of the board (edited, added or removed). */
export function changedLeadIds(before: Lead[], after: Lead[]): string[] {
  const prev = new Map(before.map((l) => [l.id, l]));
  const out: string[] = [];
  for (const l of after) {
    if (prev.get(l.id) !== l) out.push(l.id);
    prev.delete(l.id);
  }
  return [...out, ...prev.keys()];
}
