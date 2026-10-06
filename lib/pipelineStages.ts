// Server-side helpers for per-user CRM pipeline customization.
//
// A user's custom stages live in `User.pipelineStages` (JSON). This module
// validates/sanitizes arbitrary input into a safe, ordered stage list and
// guarantees the reserved anchor ids ("new-lead", "issued-paid") are always
// present so P&L, conversions and the Meta purchase event keep working no
// matter how a client rearranges their board.

import {
  PIPELINE_STAGES,
  type PipelineStage,
  type StageTone,
  STAGE_TONE_SET,
  RESERVED_STAGE_IDS,
  WON_STAGE_ID,
  INTAKE_STAGE_ID,
  MIN_STAGES,
  MAX_STAGES,
  MAX_STAGE_LABEL_LEN,
} from "@/data/pipeline";

export { PIPELINE_STAGES as DEFAULT_PIPELINE_STAGES };

const DEFAULT_BY_ID = new Map(PIPELINE_STAGES.map((s) => [s.id, s]));

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Coerce one raw stage entry into {id,label,tone}, or null if unusable. */
function cleanStage(raw: unknown, usedIds: Set<string>): PipelineStage | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const label = typeof r.label === "string" ? r.label.trim().slice(0, MAX_STAGE_LABEL_LEN) : "";
  if (!label) return null;

  const tone: StageTone = STAGE_TONE_SET.has(r.tone as StageTone) ? (r.tone as StageTone) : "slate";

  // Prefer the supplied id (so existing leads keep their column) when it's a
  // sane slug; otherwise derive one from the label. Always de-duplicate.
  let id = typeof r.id === "string" ? slugify(r.id) : "";
  if (!id) id = slugify(label) || "stage";
  let candidate = id;
  let n = 2;
  while (usedIds.has(candidate)) candidate = `${id}-${n++}`;
  usedIds.add(candidate);

  return { id: candidate, label, tone };
}

/**
 * Normalize arbitrary input into a valid, ordered stage list:
 *  - drops empty/invalid entries, trims labels, clamps tones
 *  - de-duplicates ids, caps the count at MAX_STAGES
 *  - guarantees the reserved anchors are present (re-inserting them, keeping
 *    any client-supplied label/tone, if they were dropped)
 * Returns null when the input isn't a usable array (caller falls back to
 * defaults).
 */
export function normalizeStages(input: unknown): PipelineStage[] | null {
  if (!Array.isArray(input)) return null;

  const usedIds = new Set<string>();
  const out: PipelineStage[] = [];
  for (const raw of input) {
    if (out.length >= MAX_STAGES) break;
    // Preserve a reserved id verbatim rather than slugifying/suffixing it.
    if (raw && typeof raw === "object") {
      const rid = (raw as Record<string, unknown>).id;
      if (typeof rid === "string" && (RESERVED_STAGE_IDS as readonly string[]).includes(rid) && !usedIds.has(rid)) {
        const label =
          typeof (raw as any).label === "string" && (raw as any).label.trim()
            ? (raw as any).label.trim().slice(0, MAX_STAGE_LABEL_LEN)
            : DEFAULT_BY_ID.get(rid)!.label;
        const tone: StageTone = STAGE_TONE_SET.has((raw as any).tone)
          ? (raw as any).tone
          : DEFAULT_BY_ID.get(rid)!.tone;
        usedIds.add(rid);
        out.push({ id: rid, label, tone });
        continue;
      }
    }
    const s = cleanStage(raw, usedIds);
    if (s) out.push(s);
  }

  // Ensure both reserved anchors exist. If missing, reinsert from defaults:
  // intake at the front, the won stage at the end.
  if (!usedIds.has(INTAKE_STAGE_ID)) {
    out.unshift({ ...DEFAULT_BY_ID.get(INTAKE_STAGE_ID)! });
    usedIds.add(INTAKE_STAGE_ID);
  }
  if (!usedIds.has(WON_STAGE_ID)) {
    out.push({ ...DEFAULT_BY_ID.get(WON_STAGE_ID)! });
    usedIds.add(WON_STAGE_ID);
  }

  if (out.length < MIN_STAGES) return null; // unusable → caller uses defaults
  return out;
}

/** The stages to render for a user: their customized set, or the defaults. */
export function stagesForUser(pipelineStages: unknown): PipelineStage[] {
  const normalized = normalizeStages(pipelineStages);
  return normalized ?? PIPELINE_STAGES.map((s) => ({ ...s }));
}

/** Resolve a stage's display label within a user's set (fallback: the id). */
export function labelForStage(stages: PipelineStage[], id: string): string {
  return stages.find((s) => s.id === id)?.label ?? id;
}
