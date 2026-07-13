import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  EXPORT_HEADERS,
  buildExportRows,
  fetchExportLeads,
  toCSV,
} from "@/lib/leadExport";

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
  const leads = await fetchExportLeads(
    userId,
    searchParams.get("leadIds"),
    searchParams.get("status"),
  );

  const csvContent = toCSV(EXPORT_HEADERS, buildExportRows(leads));
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
