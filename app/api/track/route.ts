import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track — first-party funnel beacon from the landing page.
 * Body: { sessionId, type: "view"|"step"|"complete", step?, source? }
 * Public (analytics only, no PII). Fire-and-forget from the browser.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
} as const;

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

const TYPES = new Set(["view", "step", "complete"]);

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS });
  }
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS });
  }

  const type = String(body?.type ?? "");
  const sessionId = String(body?.sessionId ?? "").slice(0, 64);
  if (!TYPES.has(type) || !sessionId) {
    return NextResponse.json({ ok: false }, { status: 200, headers: CORS });
  }
  const stepNum = Number(body?.step);
  const step = type === "step" && Number.isFinite(stepNum) ? Math.min(Math.max(Math.round(stepNum), 1), 30) : null;
  const source = String(body?.source ?? "abca-quiz").slice(0, 64);

  try {
    await prisma.funnelEvent.create({ data: { sessionId, type, step, source } });
  } catch {
    /* analytics must never break the page */
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
}
