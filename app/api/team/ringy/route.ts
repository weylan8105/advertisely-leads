import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { canLinkRingyFor } from "@/lib/ringyAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORBIDDEN = "You can link Ringy only for members of a team you manage, and only once your own Ringy is connected.";

/**
 * A team manager who has Ringy connects it for a downline, the same way admins
 * do from Client accounts (/api/admin/accounts/ringy). From then on, every
 * campaign lead that lands with that member is also sent to their Ringy.
 *
 * POST { userId, sid, authToken } — connect or replace their keys.
 * DELETE { userId } — disconnect.
 */
async function caller() {
  const session = await getServerSession(authOptions);
  return ((session?.user as any)?.id as string | undefined) ?? null;
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const me = await caller();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { userId?: string; sid?: string; authToken?: string };
  const userId = String(body.userId ?? "").trim();
  const sid = String(body.sid ?? "").trim();
  const authToken = String(body.authToken ?? "").trim();
  if (!userId || !sid || !authToken) {
    return NextResponse.json({ error: "userId, sid and authToken are all required." }, { status: 400 });
  }
  if (!(await canLinkRingyFor(me, userId))) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });

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
  const me = await caller();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  const userId = String(body.userId ?? "").trim();
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (!(await canLinkRingyFor(me, userId))) return NextResponse.json({ error: FORBIDDEN }, { status: 403 });

  await prisma.integration
    .delete({ where: { userId_type: { userId, type: "RINGY" } } })
    .catch(() => null);
  return NextResponse.json({ ok: true, connected: false });
}
