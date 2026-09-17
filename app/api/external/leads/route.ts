import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { authenticateApiKey, hasScope } from "@/lib/apikey";
import { NOT_TEST_LEAD } from "@/lib/testLeads";
import { stageLabel } from "@/data/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/external/leads — external, read-only lead feed (e.g. SignalDesk).
 *
 * Auth: same DB-backed API keys as /api/conversions. Canonical header:
 *   Authorization: Bearer <key>   (X-API-Key / ?key= also accepted for
 *   backward-compat; ?key= is discouraged — it leaks into logs). Scope: leads:read.
 *
 * Tenancy: cross-pipeline by design — Advertisely is a single-owner platform, so
 * the read key returns every lead the platform holds (each lead still carries its
 * account_id/organization_id). No account_id is ever accepted from the request, so
 * a caller can never pull a scope the key is not entitled to. Trashed (recycle-bin)
 * and internal test leads are excluded.
 *
 * Pagination + incremental sync: ordered by (updatedAt, id) ascending. Pass
 * ?updated_since=<RFC3339> to start from a point in time, then follow next_cursor.
 * updatedAt is auto-bumped on every write, so no modification is ever skipped.
 */

const CONVERTED_STAGE = "issued-paid";
const CURRENCY = "USD";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const PIPELINE_ID = "advertisely-crm";
const PIPELINE_NAME = "Advertisely CRM";

const LEAD_SELECT = {
  id: true, name: true, email: true, phone: true, state: true, status: true, pipelineStage: true,
  source: true, campaignName: true, adsetId: true, creativeId: true,
  utmSource: true, utmMedium: true, utmCampaign: true, fbclid: true,
  assignedUserId: true, soldAt: true, soldPremiumCents: true, organizationId: true,
  externalId: true, rawFormData: true, receivedAt: true, updatedAt: true,
  assignedUser: { select: { name: true } },
} as const;

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized — provide a valid API key." }, { status: 401 });
}
function forbidden(scope: string) {
  return NextResponse.json({ error: `API key missing required scope: ${scope}` }, { status: 403 });
}
function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

const rfc = (d: Date | null): string | null => (d ? new Date(d).toISOString() : null);
const dec = (c: number | null): string | null => (typeof c === "number" ? (c / 100).toFixed(2) : null);

function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ t: new Date(updatedAt).toISOString(), id }), "utf8").toString("base64url");
}
function decodeCursor(rawStr: string): { t: string; id: string } | null {
  try {
    const o = JSON.parse(Buffer.from(rawStr, "base64url").toString("utf8"));
    if (o && typeof o.t === "string" && typeof o.id === "string" && !isNaN(Date.parse(o.t))) return o;
  } catch {
    /* fall through */
  }
  return null;
}

// Pull a value out of the lead's raw Meta/quiz form payload, safely.
function fromRaw(l: { rawFormData?: unknown }, key: string): string | null {
  const r = l.rawFormData;
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const v = (r as Record<string, unknown>)[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

function toLead(l: any) {
  const parts = String(l.name || "").trim().split(/\s+/).filter(Boolean);
  const converted = l.pipelineStage === CONVERTED_STAGE;
  return {
    id: l.id,
    account_id: l.organizationId ?? null,
    organization_id: l.organizationId ?? null,
    first_name: parts[0] ?? null,
    last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
    full_name: l.name ?? null,
    email: l.email ?? null,
    phone: l.phone ?? null,
    status: l.status ?? null,
    pipeline_id: PIPELINE_ID,
    pipeline_name: PIPELINE_NAME,
    stage_id: l.pipelineStage ?? null,
    stage_name: l.pipelineStage ? stageLabel(l.pipelineStage) : null,
    source: l.source ?? null,
    campaign_id: null,
    campaign_name: l.campaignName ?? null,
    ad_set_id: l.adsetId ?? null,
    ad_set_name: null,
    ad_id: l.creativeId ?? null,
    ad_name: null,
    form_id: fromRaw(l, "form_id"),
    landing_page_url: fromRaw(l, "landing_url") ?? fromRaw(l, "landing_page_url"),
    utm_source: l.utmSource ?? null,
    utm_medium: l.utmMedium ?? null,
    utm_campaign: l.utmCampaign ?? null,
    utm_content: fromRaw(l, "utm_content"),
    utm_term: fromRaw(l, "utm_term"),
    fbclid: l.fbclid ?? null,
    assigned_user_id: l.assignedUserId ?? null,
    assigned_user_name: l.assignedUser?.name ?? null,
    conversion_status: converted ? "converted" : "open",
    conversion_date: rfc(l.soldAt ?? null),
    monetary_value: dec(l.soldPremiumCents ?? null),
    currency: l.soldPremiumCents != null ? CURRENCY : null,
    created_at: rfc(l.receivedAt ?? null),
    updated_at: rfc(l.updatedAt ?? null),
  };
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }
  const key = await authenticateApiKey(req);
  if (!key) return unauthorized();
  if (!hasScope(key, "leads:read")) return forbidden("leads:read");

  const sp = new URL(req.url).searchParams;
  const limit = Math.min(Math.max(parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const cursorRaw = sp.get("cursor");
  const updatedSinceRaw = sp.get("updated_since");

  // Cross-pipeline base filter: no trashed, no internal test leads.
  const base = { trashedAt: null, ...NOT_TEST_LEAD };

  let cursor: { t: string; id: string } | null = null;
  let since: Date | null = null;
  if (cursorRaw) {
    cursor = decodeCursor(cursorRaw);
    if (!cursor) return badRequest("Invalid cursor.");
  } else if (updatedSinceRaw) {
    const s = new Date(updatedSinceRaw);
    if (isNaN(s.getTime())) return badRequest("Invalid updated_since (use RFC 3339).");
    since = s;
  }

  // Keyset predicate for stable forward-only paging over (updatedAt, id).
  const where = cursor
    ? {
        AND: [
          base,
          {
            OR: [
              { updatedAt: { gt: new Date(cursor.t) } },
              { AND: [{ updatedAt: new Date(cursor.t) }, { id: { gt: cursor.id } }] },
            ],
          },
        ],
      }
    : since
      ? { AND: [base, { updatedAt: { gte: since } }] }
      : base;

  const rows = (await prisma.lead.findMany({
    where,
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: limit + 1, // one extra to detect has_more
    select: LEAD_SELECT,
  })) as any[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.updatedAt, last.id) : null;

  return NextResponse.json({
    ok: true,
    leads: page.map(toLead),
    count: page.length,
    next_cursor: nextCursor,
    has_more: hasMore,
    max_page_size: MAX_LIMIT,
  });
}
