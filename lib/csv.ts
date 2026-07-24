// Shared CSV serialization for lead delivery.
// Used by both the customer-facing export (/api/exports/csv) and the
// admin client-lookup endpoint (/api/admin/client-leads) so every CSV we
// hand off to a client has an identical, stable column layout.

/**
 * The Prisma `select` that produces a lead shape compatible with `leadsToCsv`.
 * Spread this into a `prisma.lead.findMany({ select: LEAD_CSV_SELECT })` call.
 */
export const LEAD_CSV_SELECT = {
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
} as const;

const CSV_HEADERS = [
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
];

function escapeCSV(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = Array.isArray(val) ? val.join("; ") : String(val);
  // Wrap in quotes if the value contains a comma, quote, or newline.
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toRow(l: any): (string | number)[] {
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

/**
 * Serialize an array of lead records into a CSV string (CRLF line endings,
 * Excel/Sheets friendly). Accepts any object exposing the fields listed in
 * `LEAD_CSV_SELECT`; missing optional fields render as empty cells.
 */
export function leadsToCsv(leads: any[]): string {
  const lines = [
    CSV_HEADERS.map(escapeCSV).join(","),
    ...leads.map((l) => toRow(l).map(escapeCSV).join(",")),
  ];
  return lines.join("\r\n");
}
