import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { resolveUplineCode } from "@/lib/upline";
import { allowHit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/team/code?code=X — public check for the signup form's "Do you have
 * an upline?" field. Returns only the upline's first name and team name.
 */
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  if (!allowHit(`uplinecode:${clientIp(req.headers)}`, 30, 10 * 60_000)) {
    return NextResponse.json({ valid: false, error: "Too many tries. Wait a few minutes." }, { status: 429 });
  }
  const up = await resolveUplineCode(new URL(req.url).searchParams.get("code") ?? "");
  if (!up) return NextResponse.json({ valid: false, error: "We couldn't find that code." });
  return NextResponse.json({
    valid: true,
    code: up.code,
    uplineFirstName: (up.uplineName ?? "").trim().split(/\s+/)[0] || null,
    teamName: up.teamName,
  });
}
