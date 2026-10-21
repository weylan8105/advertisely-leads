import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { normalizeInboundLead } from "@/lib/inboundLead";
import { createInboundLead } from "@/lib/inboundIntake";
import { authenticateApiKey, hasScope } from "@/lib/apikey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/inbound
 *
 * Generic inbound lead endpoint for no-code connectors (Make.com / Zapier)
 * forwarding Facebook Lead Ads — no Meta developer app required. Auth is a
 * shared secret (INBOUND_LEAD_SECRET) passed as ?key=... or the x-api-key
 * header. Accepts a single lead object or an array of them. Every field is
 * captured; standard fields are auto-mapped; the lead drops into the normal
 * fulfillment pipeline (assignment -> delivery email -> Google Sheets).
 */

// Allow browser-based connectors to POST directly. (The ABCA quiz no longer
// posts here — it uses the keyless /api/quiz/submit, so no key ships in a page.)
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-api-key, authorization",
} as const;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function secretMatches(provided: string | null): boolean {
  const expected = process.env.INBOUND_LEAD_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractKey(req: NextRequest): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("key");
  if (q) return q;
  const header = req.headers.get("x-api-key");
  if (header) return header;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return null;
}

// A quick browser-visible health check (no secrets revealed).
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "inbound-lead",
    hint: "POST lead JSON here with your key (?key=... or x-api-key header).",
  });
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return json({ error: "Database not configured." }, 503);
  }

  // Auth: a DB-backed API key with the `leads:write` scope, OR the legacy
  // INBOUND_LEAD_SECRET shared secret (kept for existing connectors).
  const apiKey = await authenticateApiKey(req);
  const authorized =
    (apiKey != null && hasScope(apiKey, "leads:write")) || secretMatches(extractKey(req));
  if (!authorized) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const items = Array.isArray(payload) ? payload : [payload];
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") {
      skipped++;
      continue;
    }
    const lead = normalizeInboundLead(item as Record<string, unknown>);
    const outcome = await createInboundLead(lead, {
      activityBody: `Lead received via inbound connector (${lead.source}).`,
    });

    switch (outcome.status) {
      case "created":
        created++;
        if (outcome.error) {
          skipped++;
          errors.push(outcome.error);
        }
        break;
      case "no-phone":
        skipped++;
        errors.push("Skipped a lead with no phone number.");
        break;
      case "failed":
        skipped++;
        errors.push(outcome.error);
        break;
      default: // duplicate externalId, or a test identity auto-trashed on intake
        skipped++;
    }
  }

  return json({ ok: true, created, skipped, errors: errors.slice(0, 5) });
}
