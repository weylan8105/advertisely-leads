import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  EXPORT_HEADERS,
  buildExportRows,
  fetchExportLeads,
  toTSV,
} from "@/lib/leadExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/exports/sheets
 *
 * Returns the authenticated user's leads as tab-separated values (TSV). The
 * client copies this to the clipboard and opens a new Google Sheet, where the
 * user pastes it in — every lead lands on its own row/column. This works today
 * without a Google service account or OAuth setup.
 *
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

  const tsv = toTSV(EXPORT_HEADERS, buildExportRows(leads));

  return new NextResponse(tsv, {
    status: 200,
    headers: {
      "Content-Type": "text/tab-separated-values; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Lead-Count": String(leads.length),
    },
  });
}
