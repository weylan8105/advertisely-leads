import { NextRequest, NextResponse } from "next/server";
import { isAdvertiserInviteToken } from "@/lib/advertiserInvite";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/advertiser-invite?token= — lets the signup page check an advertiser link. */
export async function GET(req: NextRequest) {
  return NextResponse.json({ valid: isAdvertiserInviteToken(req.nextUrl.searchParams.get("token")) });
}
