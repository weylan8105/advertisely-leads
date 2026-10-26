import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org";
import { stagesForUser, labelForStage } from "@/lib/pipelineStages";

// Shared lead-export logic so CSV and Google Sheets exports always agree on
// which leads, which columns, and in what order.

export const EXPORT_HEADERS = [
  "Lead ID",
  "Name",
  "Phone",
  "Email",
  "State",
  "Age",
  "Income",
  "Occupation",
  "Status",
  "Disposition",
  "Source",
  "Campaign",
  "Call Attempts",
  "Intent Reason",
  "Consent Method",
  "Consent Time",
  "Consent IP",
  "TrustedForm URL",
  "Tags",
  "Package",
  "Received At",
  "Last Contacted",
  "Assigned At",
] as const;

/** Which board(s) to export: your own pipeline, the team Goldmine, or both. */
export type ExportScope = "pipeline" | "goldmine" | "both";
export function parseExportScope(v: string | null | undefined): ExportScope | null {
  return v === "pipeline" || v === "goldmine" || v === "both" ? v : null;
}
export const SCOPE_FILE_LABEL: Record<ExportScope, string> = {
  pipeline: "my-pipeline",
  goldmine: "goldmine",
  both: "pipeline-and-goldmine",
};

export async function fetchExportLeads(
  userId: string,
  leadIdsParam?: string | null,
  statusParam?: string | null,
  scope?: ExportScope | null,
): Promise<any[]> {
  if (!isDatabaseConfigured || !prisma) return [];

  // No scope = legacy behavior (everything assigned to you, or the picked ids).
  let where: any = { assignedUserId: userId };
  let goldmineStages: unknown = null;
  if (scope) {
    // Same boards the CRM shows: your own main pipeline, and/or your team's
    // shared Goldmine (every member sees all of it). Trashed leads are left out.
    const ctx = scope === "pipeline" ? null : await getOrgContext(userId);
    const mine = { assignedUserId: userId, pipeline: "main" };
    const gold = ctx ? { organizationId: ctx.organizationId, pipeline: "goldmine" } : null;
    const parts = scope === "pipeline" ? [mine] : scope === "goldmine" ? (gold ? [gold] : []) : gold ? [mine, gold] : [mine];
    if (parts.length === 0) return [];
    where = { trashedAt: null, OR: parts };
    if (ctx) {
      const org = await prisma.organization.findUnique({ where: { id: ctx.organizationId }, select: { goldmineStages: true } });
      goldmineStages = org?.goldmineStages ?? null;
    }
  }
  if (leadIdsParam) {
    where.id = {
      in: leadIdsParam.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }
  if (statusParam && statusParam !== "all") {
    where.status = statusParam.toUpperCase();
  }

  const [leads, me] = await Promise.all([
    prisma.lead.findMany({
    where,
    orderBy: [{ pipeline: "desc" }, { receivedAt: "desc" }],
    select: {
      id: true,
      pipeline: true,
      pipelineStage: true,
      name: true,
      phone: true,
      email: true,
      state: true,
      age: true,
      income: true,
      occupation: true,
      status: true,
      disposition: true,
      source: true,
      campaignName: true,
      callAttempts: true,
      consentMethod: true,
      consentTime: true,
      consentIp: true,
      trustedFormUrl: true,
      tags: true,
      intentReason: true,
      receivedAt: true,
      lastContactedAt: true,
      assignedAt: true,
      packageId: true,
    },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { pipelineStages: true } }),
  ]);

  // Stage names as each board shows them (custom titles included).
  const mainStages = stagesForUser(me?.pipelineStages ?? null);
  const goldStages = stagesForUser(goldmineStages);
  return leads.map((l) => ({
    ...l,
    pipelineLabel: l.pipeline === "goldmine" ? "Goldmine" : "My pipeline",
    stageLabel: labelForStage(l.pipeline === "goldmine" ? goldStages : mainStages, l.pipelineStage),
  }));
}

export function leadToRow(l: any): (string | number)[] {
  return [
    l.id,
    l.name,
    l.phone,
    l.email,
    l.state,
    l.age ?? "",
    l.income ?? "",
    l.occupation ?? "",
    l.status,
    l.disposition ?? "",
    l.source,
    l.campaignName ?? "",
    l.callAttempts,
    l.intentReason ?? "",
    l.consentMethod,
    l.consentTime ? new Date(l.consentTime).toISOString() : "",
    l.consentIp ?? "",
    l.trustedFormUrl ?? "",
    Array.isArray(l.tags) ? l.tags.join("; ") : "",
    l.packageId,
    l.receivedAt ? new Date(l.receivedAt).toISOString() : "",
    l.lastContactedAt ? new Date(l.lastContactedAt).toISOString() : "",
    l.assignedAt ? new Date(l.assignedAt).toISOString() : "",
  ];
}

export function buildExportRows(leads: any[]): (string | number)[][] {
  return leads.map(leadToRow);
}

// Pipeline / Goldmine / both exports add the board and stage at the END, so the
// base layout above (also used for connected Google Sheets on delivery) never shifts.
export const SCOPED_EXPORT_HEADERS = [...EXPORT_HEADERS, "Pipeline", "Stage"] as const;
export function buildScopedExportRows(leads: any[]): (string | number)[][] {
  return leads.map((l) => [...leadToRow(l), l.pipelineLabel ?? "", l.stageLabel ?? ""]);
}

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = Array.isArray(val) ? val.join("; ") : String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCSV(
  headers: readonly string[],
  rows: (string | number)[][],
): string {
  return [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ].join("\r\n");
}

// Tab-separated output for pasting straight into Google Sheets. Tabs and
// newlines inside a value are flattened to spaces so every lead stays on its
// own row and column.
function sanitizeTSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = Array.isArray(val) ? val.join("; ") : String(val);
  return str.replace(/[\t\r\n]+/g, " ").trim();
}

export function toTSV(
  headers: readonly string[],
  rows: (string | number)[][],
): string {
  return [
    headers.map(sanitizeTSV).join("\t"),
    ...rows.map((row) => row.map(sanitizeTSV).join("\t")),
  ].join("\n");
}
