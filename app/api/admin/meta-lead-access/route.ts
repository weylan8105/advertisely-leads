import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { diagnoseLeadFormAccess } from "@/lib/metaAds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/meta-lead-access?formId=123[,456] — can the System User read
 * these instant forms' leads (what CRM events need to find Meta's lead id)?
 * Reports each step and Meta's error where it stops. Read-only. Admin only.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const ids = (new URL(req.url).searchParams.get("formId") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d{6,20}$/.test(s))
    .slice(0, 10);
  if (ids.length === 0) return NextResponse.json({ error: "formId is required" }, { status: 400 });
  const forms = await Promise.all(ids.map((id) => diagnoseLeadFormAccess(id)));
  return NextResponse.json({ forms });
}
