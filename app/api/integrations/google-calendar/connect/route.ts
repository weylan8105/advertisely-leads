import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isCalendarConfigured, buildConsentUrl } from "@/lib/googleCalendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/google-calendar/connect — start the OAuth consent flow. */
export async function GET(req: NextRequest) {
  const base = process.env.NEXTAUTH_URL ?? new URL(req.url).origin;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.redirect(`${base}/login`);
  if (!isCalendarConfigured()) {
    return NextResponse.redirect(`${base}/settings?tab=integrations&calendar=unconfigured`);
  }
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildConsentUrl(state));
  res.cookies.set("gcal_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
