import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { advertiserInviteToken } from "@/lib/advertiserInvite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/advertiser-invite — the advertiser signup link (admins only). */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  const token = advertiserInviteToken();
  if (!token) return NextResponse.json({ error: "Invite links aren't configured (missing app secret)." }, { status: 503 });
  const origin = process.env.NEXTAUTH_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  return NextResponse.json({ url: `${origin}/signup?advertiser=${token}` });
}
