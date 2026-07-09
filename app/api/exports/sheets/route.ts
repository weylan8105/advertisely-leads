import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/exports/sheets
 *
 * Google Sheets sync — coming soon.
 * This route is a stub that returns a clear "coming soon" response.
 * When Google Sheets integration is ready, this will:
 *   1. Exchange the user's stored OAuth refresh token for an access token
 *   2. Append rows to the user's configured Google Sheet via the Sheets API
 *   3. Return the number of rows written and the sheet URL
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: "Google Sheets sync is coming soon.",
      message:
        "Connect your Google Sheet in Settings → Integrations once this feature launches. " +
        "In the meantime, use CSV export and import it into Sheets manually.",
      comingSoon: true,
    },
    { status: 501 },
  );
}
