import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/exports/csv
 *
 * Export the authenticated user's leads as a CSV file.
 * Optional query params:
 *   - leadIds: comma-separated list of lead IDs (defaults to all assigned leads)
 *   - status: filter by status
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = (session.user as any).id as string;
  const { searchParams } = new URL(req.url);
  const leadIdsParam = searchParams.get("leadIds");
  const statusParam = searchParams.get("status");

  let leads: any[] = [];

  if (isDatabaseConfigured && prisma) {
    const where: any = { assignedUserId: userId };
    if (leadIdsParam) {
      where.id = { in: leadIdsParam.split(",").map((s) => s.trim()).filter(Boolean) };
    }
    if (statusParam && statusParam !== "all") {
      where.status = statusParam.toUpperCase();
    }

    leads = await prisma.lead.findMany({
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
  } else {
    // Fallback: return empty CSV with headers when DB is not configured
    leads = [];
  }

  // Build CSV
  const headers = [
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
    // Wrap in quotes if contains comma, quote, or newline
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  const rows = leads.map((l) => [
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
  ]);

  const csvLines = [
    headers.map(escapeCSV).join(","),
    ...rows.map((row) => row.map(escapeCSV).join(",")),
  ];
  const csvContent = csvLines.join("\r\n");

  const filename = `advertisely-leads-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
