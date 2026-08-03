import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH /api/team/settings — change how leads are distributed. Owner/Admin only. */
export async function PATCH(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ctx = await ensureOrgContext(userId);
  if (!ctx) return NextResponse.json({ error: "No organization" }, { status: 404 });
  if (!canManageTeam(ctx.role)) {
    return NextResponse.json({ error: "Only owners and admins can change team settings" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { distributionMode?: string };
  const mode = body.distributionMode;
  if (mode !== "MANUAL" && mode !== "ROUND_ROBIN") {
    return NextResponse.json({ error: "distributionMode must be MANUAL or ROUND_ROBIN" }, { status: 400 });
  }

  await prisma.organization.update({
    where: { id: ctx.organizationId },
    data: { distributionMode: mode },
  });
  return NextResponse.json({ ok: true, distributionMode: mode });
}
