// Maps Prisma DB records into the front-end `Lead` shape used by the CRM UI
// (LeadTable, LeadKanban, StatusBadge). The UI uses title-case status labels
// and a nested `consent` object, so we translate the DB enums here.

import type { Lead, LeadStatus, LeadPackageId } from "@/types";
import { leadPackages } from "@/data/packages";

const STATUS_LABEL: Record<string, LeadStatus> = {
  NEW: "New",
  CONTACTED: "Contacted",
  APPOINTMENT_SET: "Appointment Set",
  NO_ANSWER: "No Answer",
  BAD_NUMBER: "Bad Number",
  CLOSED: "Closed",
  REPLACED: "Replaced",
};

const CONSENT_LABEL: Record<string, "TCPA Web Form" | "TrustedForm" | "Jornaya"> = {
  TCPA_WEB_FORM: "TCPA Web Form",
  TRUSTED_FORM: "TrustedForm",
  JORNAYA: "Jornaya",
};

function packageLabel(id: string): string {
  return leadPackages.find((p) => p.id === id)?.name ?? id;
}

/**
 * Serialize a Prisma Lead (optionally with notes/tasks/activity/assignedUser
 * relations included) into the front-end `Lead` type.
 */
export function serializeLead(l: any): Lead {
  return {
    id: l.id,
    name: l.name,
    phone: l.phone,
    email: l.email,
    state: l.state,
    age: l.age ?? 0,
    income: l.income ?? 0,
    occupation: l.occupation ?? "",
    leadType: (l.packageId as LeadPackageId) ?? "blue-collar-iul",
    leadTypeLabel: packageLabel(l.packageId),
    status: STATUS_LABEL[l.status] ?? "New",
    disposition: l.disposition ?? undefined,
    source: l.source,
    tags: Array.isArray(l.tags) ? l.tags : [],
    consent: {
      captured: !!l.consentTime,
      method: CONSENT_LABEL[l.consentMethod] ?? "TCPA Web Form",
      timestamp: l.consentTime ? new Date(l.consentTime).toISOString() : "",
      ip: l.consentIp ?? undefined,
    },
    receivedAt: l.receivedAt ? new Date(l.receivedAt).toISOString() : "",
    lastContactedAt: l.lastContactedAt ? new Date(l.lastContactedAt).toISOString() : undefined,
    assignedAgent: l.assignedUser?.name ?? undefined,
    intentReason: l.intentReason ?? "",
    notes: (l.notes ?? []).map((n: any) => ({
      id: n.id,
      author: n.author,
      body: n.body,
      at: new Date(n.createdAt).toISOString(),
    })),
    tasks: (l.tasks ?? []).map((t: any) => ({
      id: t.id,
      leadId: t.leadId,
      leadName: l.name,
      type: String(t.type).toLowerCase() as any,
      title: t.title,
      dueAt: new Date(t.dueAt).toISOString(),
      done: t.done,
      assignedTo: t.assignedTo,
    })),
    activity: (l.activity ?? []).map((a: any) => ({
      id: a.id,
      type: String(a.type).toLowerCase() as any,
      author: a.author ?? undefined,
      body: a.body,
      at: new Date(a.createdAt).toISOString(),
    })),
    callAttempts: l.callAttempts ?? 0,
  };
}
