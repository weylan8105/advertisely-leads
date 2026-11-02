import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDatabaseConfigured, prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT /api/team/active — body { organizationId } — switch which of your teams is active. */
export async function PUT(req: NextRequest) {
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
        select: { id: true },
      })
    : null;
  if (!membership) return NextResponse.json({ error: "You're not on that team" }, { status: 404 });

  await prisma.user.update({ where: { id: userId }, data: { defaultOrganizationId: organizationId } });
  return NextResponse.json({ ok: true });
}
