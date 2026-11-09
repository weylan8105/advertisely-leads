import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { VIEW_AS_COOKIE, VIEW_AS_MAX_AGE_SECONDS } from "@/lib/viewAs";
import { USER_MODE_COOKIE } from "@/lib/userMode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/view-as { userId } — admin starts viewing that client's
 * account, read-only. { userId: null } ends it and returns to the admin's own.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { userId?: unknown };

  if (body.userId === null) {
    // Only reachable for a real admin: viewingAs is set only on ADMIN tokens.
    if (!user.viewingAs && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    const res = NextResponse.json({ viewingAs: null });
    res.cookies.delete(VIEW_AS_COOKIE);
    return res;
  }

  if (user.role !== "ADMIN" || user.viewingAs) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (typeof body.userId !== "string" || !body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true, name: true, email: true } });
  if (!target) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  if (target.id === user.id) {
    return NextResponse.json({ error: "That's your own account — use User mode instead" }, { status: 400 });
  }

  console.info(`[view-as] admin ${user.id} viewing ${target.id}`);
  const res = NextResponse.json({ viewingAs: { id: target.id, name: target.name ?? target.email } });
  res.cookies.set(VIEW_AS_COOKIE, target.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: VIEW_AS_MAX_AGE_SECONDS,
  });
  // Client view replaces user mode; leaving it lands back on the admin view.
  res.cookies.delete(USER_MODE_COOKIE);
  return res;
}
