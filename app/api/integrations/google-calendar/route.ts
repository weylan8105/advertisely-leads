import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { isCalendarConfigured, calendarRedirectUri } from "@/lib/googleCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/google-calendar — connection status for the caller. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ configured: false, connected: false });

  const integ = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: "GOOGLE_CALENDAR" } },
  });
  const cfg = (integ?.config ?? {}) as { refreshToken?: string; email?: string | null };
  return NextResponse.json({
    configured: isCalendarConfigured(),
    connected: !!(integ?.enabled && cfg.refreshToken),
    email: cfg.email ?? null,
    // The exact URI Google must have in the OAuth client's Authorized redirect URIs.
    redirectUri: calendarRedirectUri(),
  });
}

/** DELETE /api/integrations/google-calendar — disconnect the caller's calendar. */
export async function DELETE() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  await prisma.integration.deleteMany({ where: { userId, type: "GOOGLE_CALENDAR" } });
  return NextResponse.json({ ok: true });
}
