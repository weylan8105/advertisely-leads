import type { Lead, LeadTask } from "@/types";

// Mock leads removed — real leads come from the database via Stripe orders + Meta webhook.
export const mockLeads: Lead[] = [];

export const leadStatuses = [
  "New",
  "Contacted",
  "Appointment Set",
  "No Answer",
  "Bad Number",
  "Closed",
  "Replaced",
] as const;

export const leadSources: string[] = [];

export const dispositionLabels: Record<string, string> = {
  interested: "Interested",
  callback: "Callback scheduled",
  not_interested: "Not interested",
  voicemail: "Voicemail left",
  wrong_number: "Wrong number",
  do_not_call: "Do not call",
  left_message: "Left message",
  qualified: "Qualified",
  sold: "Sold",
};

export function allTasks(): LeadTask[] {
  return [];
}

export function allTags(): string[] {
  return [];
}
