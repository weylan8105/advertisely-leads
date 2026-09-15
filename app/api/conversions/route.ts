import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { authenticateApiKey, hasScope } from "@/lib/apikey";
import { fireMetaPurchaseEvent } from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Conversions API — for our own tracking/attribution tooling.
 *
 *   GET  /api/conversions   Read converted leads with full ad attribution
 *                           (utm/fbclid/campaign/adset/creative) so conversions
 *                           can be pushed to Meta/Google server-side APIs and
 *                           reported on. Auth scope: conversions:read.
 *
 *                           Two shapes, chosen by the caller:
 *                            • Legacy (default): { ok, count, conversions } — the
 *                              existing contract, unchanged. status=converted|all,
 *                              since=<date on receivedAt>, limit (1..1000, def 200).
 *                            • Sync (opt-in via ?cursor= or ?updated_since= or
 *                              ?mode=sync): stable forward-only feed ordered by
 *                              (soldAt, id) ascending with an opaque next_cursor.
 *                              Reliable incremental pull of conversions as they
 *                              happen — new conversions always append, so a poller
 *                              that stores next_cursor never skips one.
 *
 *   POST /api/conversions   Report a conversion back into Advertisely — marks
 *                           the matching lead as Issued PAID and logs the
 *                           annual premium. Match by leadId, email, or phone.
 *                           Accepts one object or an array. Auth: conversions:write.
 *
 * Auth: Authorization: Bearer <key> (canonical). x-api-key / ?key= also accepted
 * for backward compatibility; ?key= is discouraged (leaks into logs).
 *
 * Tenancy: intentionally cross-pipeline. This feed reports conversions for every
 * lead the platform generates, regardless of which buyer worked it — that is the
 * point of platform-wide conversion tracking. There is no per-tenant scoping here.
 */

const CONVERTED_STAGE = "issued-paid";
const CURRENCY = "USD";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

// Fields we read + expose. Shared by both response shapes.
const CONVERSION_SELECT = {
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
} as const;

type ConversionRow = {
  id: string;
  soldAt: Date | null;
  soldPremiumCents: number | null;
  pipelineStage: string;
  receivedAt: Date;
  [k: string]: unknown;
};

function lastTen(s: string): string {
  return s.replace(/\D/g, "").slice(-10);
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized — provide a valid API key." }, { status: 401 });
}

function forbidden(scope: string) {
  return NextResponse.json({ error: `API key missing required scope: ${scope}` }, { status: 403 });
}

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

const rfc3339 = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
const decimalStr = (cents: number | null): string | null =>
  typeof cents === "number" ? (cents / 100).toFixed(2) : null;

// Opaque forward-only cursor over the (soldAt, id) sort key.
function encodeCursor(soldAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: new Date(soldAt).toISOString(), id }), "utf8").toString("base64url");
}
function decodeCursor(raw: string): { t: string; id: string } | null {
  try {
    const obj = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (obj && typeof obj.t === "string" && typeof obj.id === "string" && !isNaN(Date.parse(obj.t))) return obj;
  } catch {
    /* fall through */
  }
  return null;
}

// Normalized, stable conversion projection (additive to the legacy fields).
function toConversion(l: ConversionRow) {
  const converted = l.pipelineStage === CONVERTED_STAGE;
  return {
    ...l,
    // Legacy field kept for existing consumers.
    converted,
    valueCents: l.soldPremiumCents ?? null,
    // Normalized contract fields (stable, additive).
    conversion_id: `cv_${l.id}`, // one conversion per lead today; stable per lead
    event_id: `cv_${l.id}`,
    lead_id: l.id,
    event_type: "Purchase",
    event_status: converted ? "recorded" : "pending",
    event_time: rfc3339(l.soldAt), // business event time (when it converted)
    recorded_time: rfc3339(l.soldAt), // see docs: no separate recorded column yet
    captured_time: rfc3339(l.receivedAt),
    value_decimal: decimalStr(l.soldPremiumCents ?? null),
    currency: l.soldPremiumCents != null ? CURRENCY : null,
  };
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
  const sp = url.searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const status = sp.get("status") ?? "converted"; // converted | all
  const cursorRaw = sp.get("cursor");
  const updatedSinceRaw = sp.get("updated_since");
  const syncMode = !!cursorRaw || !!updatedSinceRaw || sp.get("mode") === "sync";

  // ── Sync mode: stable forward-only feed keyed on (soldAt, id) asc ──
  if (syncMode) {
    const where: Record<string, unknown> = {};
    if (status !== "all") where.pipelineStage = CONVERTED_STAGE;
    // Only rows with a conversion timestamp participate in the ordered feed.
    const soldAtFilter: Record<string, unknown> = { not: null };

    let cursor: { t: string; id: string } | null = null;
    if (cursorRaw) {
      cursor = decodeCursor(cursorRaw);
      if (!cursor) return badRequest("Invalid cursor.");
    } else if (updatedSinceRaw) {
      const since = new Date(updatedSinceRaw);
      if (isNaN(since.getTime())) return badRequest("Invalid updated_since (use RFC 3339).");
      soldAtFilter.gte = since;
    }

    // Keyset predicate: soldAt > cursor.t OR (soldAt == cursor.t AND id > cursor.id)
    const whereClause = cursor
      ? {
          AND: [
            where,
            { soldAt: soldAtFilter },
            {
              OR: [
                { soldAt: { gt: new Date(cursor.t) } },
                { AND: [{ soldAt: new Date(cursor.t) }, { id: { gt: cursor.id } }] },
              ],
            },
          ],
        }
      : { AND: [where, { soldAt: soldAtFilter }] };

    const rows = (await prisma.lead.findMany({
      where: whereClause,
      orderBy: [{ soldAt: "asc" }, { id: "asc" }],
      take: limit + 1, // fetch one extra to detect has_more
      select: CONVERSION_SELECT,
    })) as unknown as ConversionRow[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor = hasMore && last?.soldAt ? encodeCursor(last.soldAt, last.id) : null;

    return NextResponse.json({
      ok: true,
      count: page.length,
      conversions: page.map(toConversion),
      next_cursor: nextCursor,
      has_more: hasMore,
      max_page_size: MAX_LIMIT,
    });
  }

  // ── Legacy mode (unchanged contract): { ok, count, conversions } ──
  const where: Record<string, unknown> = {};
  if (status === "converted") where.pipelineStage = CONVERTED_STAGE;
  const sinceRaw = sp.get("since");
  if (sinceRaw) {
    const since = new Date(sinceRaw);
    if (!isNaN(since.getTime())) where.receivedAt = { gte: since };
  }

  const rows = (await prisma.lead.findMany({
    where,
    orderBy: { soldAt: "desc" },
    take: limit,
    select: CONVERSION_SELECT,
  })) as unknown as ConversionRow[];

  return NextResponse.json({
    ok: true,
    count: rows.length,
    conversions: rows.map(toConversion),
    next_cursor: null, // additive; use ?mode=sync for the paginated feed
  });
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
