import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/assignees
 * Admin-only. Every Advertisely account, for the lead "Assign to…" picker —
 * platform admins can hand a lead to anyone, not just their own team.
 */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const users = await prisma.user.findMany({ select: { id: true, name: true, email: true } });
  users.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, "en", { sensitivity: "base" }));
  return NextResponse.json({
    accounts: users.map((u) => ({ userId: u.id, name: u.name, email: u.email })),
  });
}
