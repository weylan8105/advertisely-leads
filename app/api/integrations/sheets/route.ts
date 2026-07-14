import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import {
  isSheetsConfigured,
  sheetsServiceAccountEmail,
  parseSpreadsheetId,
  getFirstCell,
  appendRows,
} from "@/lib/sheets";
import { EXPORT_HEADERS } from "@/lib/leadExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireUser() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  return userId ?? null;
}

/** Connection status + the service-account email the client must share with. */
export async function GET() {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let connected = false;
  let spreadsheetId: string | undefined;
  if (isDatabaseConfigured && prisma) {
    const integration = await prisma.integration.findUnique({
      where: { userId_type: { userId, type: "GOOGLE_SHEETS" } },
    });
    connected = !!integration?.enabled;
    spreadsheetId = (integration?.config as any)?.spreadsheetId;
  }

  return NextResponse.json({
    configured: isSheetsConfigured,
    serviceAccountEmail: sheetsServiceAccountEmail,
    connected,
    spreadsheetId,
  });
}

/** Connect a Google Sheet: verify access, seed headers, and store it. */
export async function POST(req: NextRequest) {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  if (!isSheetsConfigured) {
    return NextResponse.json(
      { error: "Google Sheets isn't enabled on the server yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: { sheetUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const spreadsheetId = parseSpreadsheetId(body.sheetUrl ?? "");
  if (!spreadsheetId) {
    return NextResponse.json(
      { error: "That doesn't look like a Google Sheets link. Paste the full URL of your sheet." },
      { status: 400 },
    );
  }

  // Confirm we can actually reach the sheet (i.e. it's been shared with us).
  const firstCell = await getFirstCell(spreadsheetId);
  if (!firstCell.ok) {
    const shareMsg = `Couldn't open that sheet. In Google Sheets, click Share and add ${sheetsServiceAccountEmail} as an Editor, then try again.`;
    return NextResponse.json({ error: shareMsg }, { status: 400 });
  }

  // Seed the header row on a fresh sheet (also confirms we have write access).
  if (firstCell.value !== EXPORT_HEADERS[0]) {
    const seed = await appendRows(spreadsheetId, [Array.from(EXPORT_HEADERS)]);
    if (!seed.ok) {
      return NextResponse.json(
        {
          error: `We can see the sheet but can't write to it. Make sure ${sheetsServiceAccountEmail} has Editor (not Viewer) access.`,
        },
        { status: 400 },
      );
    }
  }

  await prisma.integration.upsert({
    where: { userId_type: { userId, type: "GOOGLE_SHEETS" } },
    update: { enabled: true, config: { spreadsheetId, sheetName: "Sheet1" } },
    create: {
      userId,
      type: "GOOGLE_SHEETS",
      config: { spreadsheetId, sheetName: "Sheet1" },
    },
  });

  return NextResponse.json({ ok: true, connected: true, spreadsheetId });
}

/** Disconnect the sheet. */
export async function DELETE() {
  const userId = await requireUser();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  await prisma.integration
    .delete({ where: { userId_type: { userId, type: "GOOGLE_SHEETS" } } })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
