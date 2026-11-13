import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { forwardLeadToRingy, isRingyConfigured, type RingyConfig } from "@/lib/ringy";
import { canManageRingyOf, ringyTestLead } from "@/lib/ringyAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { userId? } — send one clearly fake test lead into a Ringy account to
 * check the keys work. Your own (no userId), or someone you manage it for:
 * site admins for anyone, uplines with Ringy for their downlines.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { userId?: string };
  const userId = String(body.userId ?? "").trim() || callerId;
  if (!(await canManageRingyOf(callerId, userId, (session?.user as any)?.role))) {
    return NextResponse.json({ error: "You can't send a test lead to this account's Ringy." }, { status: 403 });
  }

  const row = await prisma.integration.findUnique({
    where: { userId_type: { userId, type: "RINGY" } },
    select: { id: true, enabled: true, config: true },
  });
  const cfg = row?.config as Partial<RingyConfig> | undefined;
  if (!row?.enabled || !isRingyConfigured(cfg)) {
    return NextResponse.json({ error: "Ringy isn't connected for this account." }, { status: 400 });
  }

  const result = await forwardLeadToRingy(ringyTestLead(), cfg);
  if (result.ok) await prisma.integration.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  return NextResponse.json(
    { ok: result.ok, status: result.status ?? null, vendorResponseId: result.vendorResponseId ?? null, error: result.error ?? null },
    { status: result.ok ? 200 : 502 },
  );
}
