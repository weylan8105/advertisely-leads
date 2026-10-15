// Sales pipeline stages for the built-in CRM (kanban board). Ordered.
// Stored on Lead.pipelineStage as the stage `id` (string, so stages can be
// tuned without an enum migration).

export type StageTone = "slate" | "red" | "amber" | "blue" | "indigo" | "emerald" | "rose";

export interface PipelineStage {
  id: string;
  label: string;
  tone: StageTone;
}

export const PIPELINE_STAGES: PipelineStage[] = [
  { id: "new-lead", label: "New Lead", tone: "red" },
  { id: "aged-lead", label: "Dialed", tone: "slate" },
  { id: "follow-up", label: "Contacted", tone: "amber" },
  { id: "call-back", label: "Call Back", tone: "blue" },
  { id: "dnc", label: "DNC / Not Interested / Unqualified", tone: "rose" },
  { id: "presentation-ran", label: "Presentation Ran / Follow up", tone: "indigo" },
  { id: "underwriting", label: "Underwriting", tone: "blue" },
  { id: "approved", label: "Approved", tone: "emerald" },
  { id: "issued-not-paid", label: "Issued Not Paid", tone: "amber" },
  { id: "issued-paid", label: "Issued PAID 💰", tone: "emerald" },
  { id: "chargeback", label: "Chargeback", tone: "rose" },
];

export const DEFAULT_STAGE = "new-lead";

export const STAGE_IDS = PIPELINE_STAGES.map((s) => s.id);

export function findStage(id: string): PipelineStage | undefined {
  return PIPELINE_STAGES.find((s) => s.id === id);
}

export function stageLabel(id: string): string {
  return findStage(id)?.label ?? id;
}

// ── Customization anchors ────────────────────────────────────────────────
// Clients can rename, recolor, reorder, add and delete pipeline stages — EXCEPT
// the conversion stages below, which are FIXED.
//
// CONVERSION_STAGE_IDS are wired to the Meta Conversions API (see lib/metaCapi.ts
// STAGE_EVENTS) — moving a lead into one fires an ad-optimization event. They are
// fully locked (no rename/recolor/delete) so ad performance tracking never breaks.
// "new-lead" is the intake anchor (default stage + routing): it can be
// relabeled/recolored but never removed.
export const CONVERSION_STAGE_IDS = ["underwriting", "approved", "issued-not-paid", "issued-paid"] as const;
export const INTAKE_STAGE_ID = "new-lead";
export const WON_STAGE_ID = "issued-paid";

// Stages that must ALWAYS exist and can't be deleted (intake + all conversion
// stages). Conversion stages are additionally locked from renaming/recoloring.
export const RESERVED_STAGE_IDS = [INTAKE_STAGE_ID, ...CONVERSION_STAGE_IDS] as const;

export function isReservedStage(id: string): boolean {
  return (RESERVED_STAGE_IDS as readonly string[]).includes(id);
}

/** Conversion-API stage — fully locked (no rename/recolor/delete). */
export function isConversionStage(id: string): boolean {
  return (CONVERSION_STAGE_IDS as readonly string[]).includes(id);
}

// Color options offered in the stage editor (value = StageTone, plus a swatch
// class for the picker and a human label).
export const STAGE_TONES: { value: StageTone; label: string; dot: string }[] = [
  { value: "red", label: "Red", dot: "bg-brand-red" },
  { value: "amber", label: "Amber", dot: "bg-amber-500" },
  { value: "blue", label: "Blue", dot: "bg-blue-500" },
  { value: "indigo", label: "Indigo", dot: "bg-indigo-500" },
  { value: "emerald", label: "Green", dot: "bg-emerald-500" },
  { value: "rose", label: "Rose", dot: "bg-rose-500" },
  { value: "slate", label: "Gray", dot: "bg-slate-400" },
];

export const STAGE_TONE_SET = new Set<StageTone>(STAGE_TONES.map((t) => t.value));

// Per-tone styles for the list view: a soft full-row tint + a stage badge.
// (Literal class strings so Tailwind's JIT picks them up.)
export const STAGE_TONE_STYLES: Record<StageTone, { row: string; badge: string; dot: string }> = {
  red: { row: "bg-red-50", badge: "bg-red-100 text-red-700 border-red-200", dot: "bg-brand-red" },
  amber: { row: "bg-amber-50", badge: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  blue: { row: "bg-blue-50", badge: "bg-blue-100 text-blue-700 border-blue-200", dot: "bg-blue-500" },
  indigo: { row: "bg-indigo-50", badge: "bg-indigo-100 text-indigo-700 border-indigo-200", dot: "bg-indigo-500" },
  emerald: { row: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  rose: { row: "bg-rose-50", badge: "bg-rose-100 text-rose-700 border-rose-200", dot: "bg-rose-500" },
  slate: { row: "bg-slate-50", badge: "bg-slate-100 text-slate-700 border-slate-200", dot: "bg-slate-400" },
};

export const MIN_STAGES = 2;
export const MAX_STAGES = 24;
export const MAX_STAGE_LABEL_LEN = 48;
