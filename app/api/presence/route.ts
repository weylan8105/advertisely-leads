import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { getOrgContext } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A "Talking to" older than this is treated as over (the agent moved on without clearing it). */
const STALE_MS = 30 * 60_000;

/**
 * GET /api/presence — which lead each teammate is on the phone with right now.
 * Returns { talking: [{ userId, name, email, leadId, since }] } for the caller's
 * team, excluding the caller and anything older than 30 minutes.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ talking: [] });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await getOrgContext(userId);
  if (!ctx) return NextResponse.json({ talking: [] });
  const rows = await prisma.membership.findMany({
    where: {
      organizationId: ctx.organizationId,
      userId: { not: userId },
      user: { talkingLeadId: { not: null }, talkingAt: { gt: new Date(Date.now() - STALE_MS) } },
    },
    select: { user: { select: { id: true, name: true, email: true, talkingLeadId: true, talkingAt: true } } },
  });
  return NextResponse.json({
    talking: rows.map(({ user: u }) => ({
      userId: u.id,
      name: u.name,
      email: u.email,
      leadId: u.talkingLeadId,
      since: u.talkingAt?.toISOString(),
    })),
  });
}

/** POST /api/presence  Body: { leadId: string | null } — set or clear who the caller is talking to. */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ ok: false }, { status: 503 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { leadId?: unknown };
  const leadId = typeof body.leadId === "string" && body.leadId && body.leadId.length <= 64 ? body.leadId : null;
  await prisma.user.update({
    where: { id: userId },
    data: { talkingLeadId: leadId, talkingAt: leadId ? new Date() : null },
  });
  return NextResponse.json({ ok: true });
}
