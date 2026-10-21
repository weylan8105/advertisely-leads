import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { REFERRAL_PROGRAM_ENABLED } from "@/lib/flags";
import { findCodeOwner } from "@/lib/referral";
import { allowHit } from "@/lib/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/referral/validate?code=X — is this a usable code for the caller?
 * Returns only the owner's first name (never contact details). Draft; 404 while off.
 */
export async function GET(req: NextRequest) {
  if (!REFERRAL_PROGRAM_ENABLED) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!allowHit(`refcode:${userId}`, 30, 60_000)) {
    return NextResponse.json({ valid: false, error: "Too many tries — wait a minute." }, { status: 429 });
  }
  const owner = await findCodeOwner(new URL(req.url).searchParams.get("code") ?? "");
  if (!owner?.referralCode) return NextResponse.json({ valid: false, error: "That code doesn't exist." });
  if (owner.id === userId) return NextResponse.json({ valid: false, error: "You can't use your own code." });
  return NextResponse.json({ valid: true, code: owner.referralCode, ownerFirstName: (owner.name ?? "").split(/\s+/)[0] || null });
}
