import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  EXPORT_HEADERS,
  SCOPED_EXPORT_HEADERS,
  buildExportRows,
  buildScopedExportRows,
  fetchExportLeads,
  parseExportScope,
  SCOPE_FILE_LABEL,
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
 *   - scope: pipeline | goldmine | both (your board, the team Goldmine, or both)
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
    parseExportScope(searchParams.get("scope")),
  );

  const csvContent = searchParams.get("scope") && parseExportScope(searchParams.get("scope"))
    ? toCSV(SCOPED_EXPORT_HEADERS, buildScopedExportRows(leads))
    : toCSV(EXPORT_HEADERS, buildExportRows(leads));
  const scope = parseExportScope(searchParams.get("scope"));
  const filename = `advertisely-${scope ? SCOPE_FILE_LABEL[scope] : "leads"}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Lead-Count": String(leads.length),
    },
  });
}
