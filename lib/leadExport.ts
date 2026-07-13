import { prisma, isDatabaseConfigured } from "@/lib/prisma";

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

export async function fetchExportLeads(
  userId: string,
  leadIdsParam?: string | null,
  statusParam?: string | null,
): Promise<any[]> {
  if (!isDatabaseConfigured || !prisma) return [];

  const where: any = { assignedUserId: userId };
  if (leadIdsParam) {
    where.id = {
      in: leadIdsParam.split(",").map((s) => s.trim()).filter(Boolean),
    };
  }
  if (statusParam && statusParam !== "all") {
    where.status = statusParam.toUpperCase();
  }

  return prisma.lead.findMany({
    where,
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
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
  });
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
