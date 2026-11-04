import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Admin-only management of an advertiser's Ringy forwarding credentials.
 *
 * POST { userId, sid, authToken } — connect/update. Stored on a per-user RINGY
 *   Integration (config = { sid, authToken }); from then on every lead
 *   owner-delivered to that user is also POSTed to their Ringy account.
 * DELETE { userId } — disconnect (stops forwarding; removes the stored keys).
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { userId?: string; sid?: string; authToken?: string };
  const userId = String(body.userId ?? "").trim();
  const sid = String(body.sid ?? "").trim();
  const authToken = String(body.authToken ?? "").trim();
  if (!userId || !sid || !authToken) {
    return NextResponse.json({ error: "userId, sid and authToken are all required." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  await prisma.integration.upsert({
    where: { userId_type: { userId, type: "RINGY" } },
    update: { enabled: true, config: { sid, authToken } },
    create: { userId, type: "RINGY", config: { sid, authToken } },
  });
  return NextResponse.json({ ok: true, connected: true });
}

export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  await prisma.integration
    .delete({ where: { userId_type: { userId, type: "RINGY" } } })
    .catch(() => null);
  return NextResponse.json({ ok: true, connected: false });
}
