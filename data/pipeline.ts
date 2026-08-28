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
  { id: "new-lead", label: "New Lead (Form Submitted)", tone: "red" },
  { id: "aged-lead", label: "Aged Lead (3 Days +)", tone: "slate" },
  { id: "follow-up", label: "Follow Up", tone: "amber" },
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
