import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/track — first-party funnel beacon from the landing page.
 * Body: { sessionId, type: "view"|"step"|"complete"|"zip_error"|"knockout", step?, source?, fbclid?, cta?, variant? }
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

// zip_error = the visitor tapped the hero/final ZIP button without a valid
// 5-digit ZIP (step holds how many digits they had typed, 0-4).
// knockout = a work answer ended the quiz on the not-a-fit screen (step = that screen).
const TYPES = new Set(["view", "step", "complete", "zip_error", "knockout"]);

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
  const step = !Number.isFinite(stepNum)
    ? null
    : type === "step" || type === "knockout"
      ? Math.min(Math.max(Math.round(stepNum), 1), 30)
      : type === "zip_error"
        ? Math.min(Math.max(Math.round(stepNum), 0), 5)
        : null;
  const source = String(body?.source ?? "abca-quiz").slice(0, 64);
  const fbclid = body?.fbclid ? String(body.fbclid).slice(0, 255) : null;
  // Entry point that started the quiz (e.g. "hero_zip_auto", "header"); slug only.
  const cta = body?.cta ? String(body.cta).replace(/[^a-z0-9_]/gi, "").slice(0, 32) || null : null;
  // Landing-page test arm: "A"/"B" (Oct hero test) or "LP"/"IF" (Nov 16 page test:
  // the live page vs /qualify). Anything else (e.g. "QA") is ignored.
  // "OPEN" = the /open no-knockout page (Nov 24 2026 split test vs the knockout page at /).
  const variant = ["A", "B", "LP", "IF", "OPEN"].includes(body?.variant) ? (body.variant as string) : null;

  try {
    await prisma.funnelEvent.create({ data: { sessionId, type, step, source, fbclid, cta, variant } });
  } catch {
    /* analytics must never break the page */
  }
  return NextResponse.json({ ok: true }, { status: 200, headers: CORS });
}
