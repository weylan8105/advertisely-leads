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
// Clients can rename, recolor, reorder, add and delete pipeline stages, but
// these two ids must always exist so the rest of the app keeps working:
//   • "new-lead"   — where fresh leads land (the default stage).
//   • "issued-paid" — the "sold" stage that feeds P&L, conversions and the
//                     annual-premium prompt / Meta purchase event.
// They can be relabeled/recolored/moved, just never removed.
export const RESERVED_STAGE_IDS = ["new-lead", "issued-paid"] as const;
export const WON_STAGE_ID = "issued-paid";
export const INTAKE_STAGE_ID = "new-lead";

export function isReservedStage(id: string): boolean {
  return (RESERVED_STAGE_IDS as readonly string[]).includes(id);
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

export const MIN_STAGES = 2;
export const MAX_STAGES = 24;
export const MAX_STAGE_LABEL_LEN = 48;
