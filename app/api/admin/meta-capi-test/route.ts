import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, hasScope } from "@/lib/apikey";
import { sendMetaTestEvent } from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/meta-capi-test
 *
 * Diagnostic: makes the server send a benign test event to Meta and returns
 * Meta's response, so we can confirm the Conversions API token + pixel are
 * wired without exposing the token. Auth: a DB-backed API key (conversions:read).
 */
export async function GET(req: NextRequest) {
  const key = await authenticateApiKey(req);
  if (!key || !hasScope(key, "conversions:read")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await sendMetaTestEvent();
  return NextResponse.json(result);
}
