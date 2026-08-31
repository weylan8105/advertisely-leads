import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { authenticateApiKey, hasScope } from "@/lib/apikey";
import { fireMetaPurchaseEvent } from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conversions API — for our marketing/attribution partner.
 *
 *   GET  /api/conversions   Read converted leads with full ad attribution
 *                           (utm/fbclid/campaign/adset/creative) so conversions
 *                           can be pushed to Meta/Google server-side APIs and
 *                           reported on. Auth: conversions:read.
 *
 *   POST /api/conversions   Report a conversion back into Advertisely — marks
 *                           the matching lead as Issued PAID and logs the
 *                           annual premium. Match by leadId, email, or phone.
 *                           Accepts one object or an array. Auth: conversions:write.
 *
 * Auth: Bearer token / x-api-key header / ?key= query param.
 */

const CONVERTED_STAGE = "issued-paid";

function lastTen(s: string): string {
  return s.replace(/\D/g, "").slice(-10);
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized — provide a valid API key." }, { status: 401 });
}

function forbidden(scope: string) {
  return NextResponse.json({ error: `API key missing required scope: ${scope}` }, { status: 403 });
}

// ── Read: converted leads + attribution ──────────────────────────────
export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  const key = await authenticateApiKey(req);
  if (!key) return unauthorized();
  if (!hasScope(key, "conversions:read")) return forbidden("conversions:read");

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? "converted"; // converted | all
  const sinceRaw = url.searchParams.get("since");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1), 1000);

  const where: Record<string, unknown> = {};
  if (status === "converted") where.pipelineStage = CONVERTED_STAGE;
  if (sinceRaw) {
    const since = new Date(sinceRaw);
    if (!isNaN(since.getTime())) where.receivedAt = { gte: since };
  }

  const leads = await prisma.lead.findMany({
    where,
    orderBy: { soldAt: "desc" },
    take: limit,
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      state: true,
      packageId: true,
      pipelineStage: true,
      status: true,
      soldAt: true,
      soldPremiumCents: true,
      source: true,
      campaignName: true,
      adsetId: true,
      creativeId: true,
      utmSource: true,
      utmMedium: true,
      utmCampaign: true,
      fbclid: true,
      receivedAt: true,
      assignedAt: true,
    },
  });

  const conversions = leads.map((l) => ({
    ...l,
    converted: l.pipelineStage === CONVERTED_STAGE,
    valueCents: l.soldPremiumCents ?? null,
  }));

  return NextResponse.json({ ok: true, count: conversions.length, conversions });
}

// ── Write: report a conversion ────────────────────────────────────────
type ConversionInput = {
  leadId?: string;
  email?: string;
  phone?: string;
  event?: string;
  value?: number; // annual premium in dollars
  currency?: string;
  occurredAt?: string;
};

async function findLead(input: ConversionInput) {
  if (!prisma) return null;
  if (input.leadId) {
    return prisma.lead.findUnique({ where: { id: input.leadId } });
  }
  if (input.email) {
    const hit = await prisma.lead.findFirst({
      where: { email: { equals: input.email, mode: "insensitive" } },
      orderBy: { receivedAt: "desc" },
    });
    if (hit) return hit;
  }
  if (input.phone) {
    const ten = lastTen(input.phone);
    if (ten.length === 10) {
      // Match on the last 10 digits regardless of stored formatting.
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Lead"
        WHERE RIGHT(regexp_replace("phone", '\D', '', 'g'), 10) = ${ten}
        ORDER BY "receivedAt" DESC
        LIMIT 1`;
      if (rows[0]) return prisma.lead.findUnique({ where: { id: rows[0].id } });
    }
  }
  return null;
}

async function applyConversion(input: ConversionInput) {
  const lead = await findLead(input);
  if (!lead) {
    const id = input.leadId ?? input.email ?? input.phone ?? "(none)";
    return { ok: false as const, matched: id, error: "No matching lead found." };
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const soldAt = isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
  const valueCents =
    typeof input.value === "number" && isFinite(input.value)
      ? Math.round(input.value * 100)
      : lead.soldPremiumCents ?? null;

  await prisma!.lead.update({
    where: { id: lead.id },
    data: {
      pipelineStage: CONVERTED_STAGE,
      status: "CLOSED",
      soldAt,
      soldPremiumCents: valueCents,
      activity: {
        create: {
          type: "STATUS_CHANGED",
          body: `Conversion reported via API${input.event ? ` (${input.event})` : ""}${
            valueCents != null ? ` — AP $${(valueCents / 100).toLocaleString()}` : ""
          }.`,
        },
      },
    },
  });

  // Fire the server-side Meta "Purchase" conversion (no-op if unconfigured).
  await fireMetaPurchaseEvent(lead.id, valueCents);

  return { ok: true as const, leadId: lead.id, name: lead.name, valueCents };
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  const key = await authenticateApiKey(req);
  if (!key) return unauthorized();
  if (!hasScope(key, "conversions:write")) return forbidden("conversions:write");

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const items = (Array.isArray(payload) ? payload : [payload]) as ConversionInput[];
  if (items.length === 0 || items.length > 500) {
    return NextResponse.json({ error: "Send 1–500 conversion objects." }, { status: 400 });
  }

  const results = [];
  let recorded = 0;
  let unmatched = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || (!item.leadId && !item.email && !item.phone)) {
      unmatched++;
      results.push({ ok: false, error: "Each item needs leadId, email, or phone." });
      continue;
    }
    const res = await applyConversion(item);
    if (res.ok) recorded++;
    else unmatched++;
    results.push(res);
  }

  return NextResponse.json({ ok: true, recorded, unmatched, results });
}
