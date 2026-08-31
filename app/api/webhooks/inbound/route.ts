import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { normalizeInboundLead } from "@/lib/inboundLead";
import { tryFulfillForNewLead } from "@/lib/fulfillment";
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

// Allow the hosted quiz funnel (any domain) to POST directly from the browser.
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

    // A lead we can't contact is worse than none — require a phone.
    if (!lead.standardized.phone) {
      skipped++;
      errors.push("Skipped a lead with no phone number.");
      continue;
    }

    // Idempotency when the connector supplies a stable id.
    if (lead.externalId) {
      const existing = await prisma.lead.findUnique({
        where: { externalId: lead.externalId },
      });
      if (existing) {
        skipped++;
        continue;
      }
    }

    try {
      const record = await prisma.lead.create({
        data: {
          externalId: lead.externalId,
          name: lead.standardized.name,
          phone: lead.standardized.phone,
          email: lead.standardized.email,
          state: lead.standardized.state,
          age: lead.standardized.age,
          income: lead.standardized.income,
          occupation: lead.standardized.occupation,
          intentReason: lead.standardized.intentReason,
          packageId: lead.packageId,
          source: lead.source,
          campaignName: lead.attribution.campaignName,
          adsetId: lead.attribution.adsetId,
          creativeId: lead.attribution.creativeId,
          utmSource: lead.attribution.utmSource,
          utmMedium: lead.attribution.utmMedium,
          utmCampaign: lead.attribution.utmCampaign,
          fbclid: lead.attribution.fbclid,
          consentTime: new Date(),
          consentIp: lead.raw["consent_ip"] || undefined,
          rawFormData: lead.raw,
          activity: {
            create: {
              type: "LEAD_RECEIVED",
              body: `Lead received via inbound connector (${lead.source}).`,
            },
          },
        },
      });
      created++;
      // Assign to an open order immediately (fires email + Sheets sync).
      await tryFulfillForNewLead(record.id);
    } catch (err) {
      skipped++;
      errors.push((err as Error).message.slice(0, 200));
    }
  }

  return json({ ok: true, created, skipped, errors: errors.slice(0, 5) });
}
