import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";
import { ensureOwnedOrganization, refileOwnOrders } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/team/leave — body { organizationId } — leave a team you're an agent
 * or admin on (e.g. one you joined by mistake). Owners can't leave their own
 * team. Your leads stay in your CRM, and lead orders you bought move to your
 * own team; if it was your active team, you switch to your own.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { organizationId?: unknown };
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const membership = organizationId
    ? await prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: { id: true, role: true },
      })
    : null;
  if (!membership) return NextResponse.json({ error: "You're not on that team" }, { status: 404 });
  if (membership.role === "OWNER") {
    return NextResponse.json({ error: "You own this team, so you can't leave it." }, { status: 400 });
  }

  await prisma.membership.delete({ where: { id: membership.id } });
  const own = await ensureOwnedOrganization(userId);
  if (own) await refileOwnOrders(userId, [organizationId], own.id);
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { defaultOrganizationId: true } });
  if (me?.defaultOrganizationId === organizationId) {
    await prisma.user.update({ where: { id: userId }, data: { defaultOrganizationId: own?.id ?? null } });
  }
  return NextResponse.json({ ok: true });
}
