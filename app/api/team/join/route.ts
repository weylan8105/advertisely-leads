import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { joinUplineTeam } from "@/lib/upline";
import { allowHit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/team/join — body { code } — an existing account joins its upline's
 * team with their code. Same as entering the code at signup: on the team right
 * away with its Goldmine; round-robin leads once a team manager adds them.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowHit(`teamjoin:${userId}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many tries. Wait a few minutes." }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { code?: unknown };
  const result = await joinUplineTeam(userId, body.code);
  switch (result.status) {
    case "invalid":
      return NextResponse.json({ error: "We couldn't find that code." }, { status: 404 });
    case "own-code":
      return NextResponse.json({ error: "That's your own code. Enter your upline's code." }, { status: 400 });
    default:
      return NextResponse.json({ ok: true, ...result });
  }
}
