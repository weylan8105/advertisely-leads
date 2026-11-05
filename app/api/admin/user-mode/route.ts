import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { USER_MODE_COOKIE, USER_MODE_MAX_AGE_SECONDS } from "@/lib/userMode";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/user-mode { enabled } — turn admin user mode on or off.
 * While it's on the session reports a client role, so `userMode` is what lets
 * the admin back out.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "ADMIN" && !user.userMode) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
  if (typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  }

  const res = NextResponse.json({ userMode: body.enabled });
  if (body.enabled) {
    res.cookies.set(USER_MODE_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: USER_MODE_MAX_AGE_SECONDS,
    });
  } else {
    res.cookies.delete(USER_MODE_COOKIE);
  }
  return res;
}
