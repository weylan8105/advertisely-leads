import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { isRingyConfigured, type RingyConfig } from "@/lib/ringy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The signed-in user's own Ringy CRM (Settings → Integrations).
 * GET — { connected, show, lastUsedAt }. show = advertisers, plus anyone already connected.
 * POST { sid, authToken } — connect or replace their keys.
 * DELETE — unlink (stops forwarding; removes the stored keys).
 */
async function me() {
  const session = await getServerSession(authOptions);
  return ((session?.user as any)?.id as string | undefined) ?? null;
}

export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ connected: false, show: false });
  const userId = await me();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [row, user] = await Promise.all([
    prisma.integration.findUnique({
      where: { userId_type: { userId, type: "RINGY" } },
      select: { enabled: true, config: true, lastUsedAt: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { isAdvertiser: true } }),
  ]);
  const connected = !!row?.enabled && isRingyConfigured(row.config as Partial<RingyConfig> | null);
  return NextResponse.json({
    connected,
    show: connected || !!row || !!user?.isAdvertiser,
    lastUsedAt: row?.lastUsedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const userId = await me();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { sid?: string; authToken?: string };
  const sid = String(body.sid ?? "").trim();
  const authToken = String(body.authToken ?? "").trim();
  if (!sid || !authToken) return NextResponse.json({ error: "Both the SID and Auth Token are required." }, { status: 400 });
  await prisma.integration.upsert({
    where: { userId_type: { userId, type: "RINGY" } },
    update: { enabled: true, config: { sid, authToken } },
    create: { userId, type: "RINGY", config: { sid, authToken } },
  });
  return NextResponse.json({ ok: true, connected: true });
}

export async function DELETE() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const userId = await me();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.integration.delete({ where: { userId_type: { userId, type: "RINGY" } } }).catch(() => null);
  return NextResponse.json({ ok: true, connected: false });
}
