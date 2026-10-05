import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { exchangeCode, emailFromIdToken } from "@/lib/googleCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/google-calendar/callback — OAuth redirect target. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const base = process.env.NEXTAUTH_URL ?? url.origin;
  const done = (status: string) => NextResponse.redirect(`${base}/settings?tab=integrations&calendar=${status}`);

  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.redirect(`${base}/login`);
  if (!isDatabaseConfigured || !prisma) return done("error");

  if (url.searchParams.get("error")) return done("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("gcal_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) return done("error");

  try {
    const tok = await exchangeCode(code);
    if (!tok.refresh_token) return done("norefresh");
    const email = emailFromIdToken(tok.id_token);
    await prisma.integration.upsert({
      where: { userId_type: { userId, type: "GOOGLE_CALENDAR" } },
      update: { enabled: true, config: { refreshToken: tok.refresh_token, email } },
      create: { userId, type: "GOOGLE_CALENDAR", enabled: true, config: { refreshToken: tok.refresh_token, email } },
    });
    const res = done("connected");
    res.cookies.set("gcal_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e) {
    console.warn("Google Calendar connect failed:", e);
    return done("error");
  }
}
