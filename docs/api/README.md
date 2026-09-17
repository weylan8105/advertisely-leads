# Advertisely Integration API — reference

For Advertisely's own tracking/attribution tooling (Conversion Hammer). Read
conversions across the whole platform and (write path) report conversions back.

- **Base URL:** `https://advertisely.io`
- **Spec:** [`openapi.yaml`](./openapi.yaml) (OpenAPI 3.1)
- **Auth (canonical):** `Authorization: Bearer <key>`
  - Also accepted (legacy): `X-API-Key: <key>`, `?key=<key>` — `?key=` is
    discouraged because it leaks into server/proxy logs.
- **Scopes:** `conversions:read` (GET), `conversions:write` (POST). The tracking
  integration key is **read-only** (`conversions:read` only).
- **Secrets:** keep the key in server-side secret storage only. Never in client
  JS, `NEXT_PUBLIC_*`, URLs, logs, screenshots, tickets, or chat.

> **Tenancy:** the conversions feed is intentionally **cross-pipeline** — it
> reports conversions for every lead the platform generates, regardless of which
> buyer worked it. There is no per-tenant filter on this endpoint.

## Read leads (external sync)

`GET /api/external/leads` — read-only lead feed for external analytics/sync
(SignalDesk). Same API-key auth as conversions; scope **`leads:read`**.

- **Cross-pipeline** by design (single-owner platform). No `account_id` is
  accepted from the request, so a caller can never pull a scope the key is not
  entitled to. Trashed (recycle-bin) and internal test leads are excluded.
- **Incremental sync:** ordered by `(updated_at, id)` ascending. `updated_at` is
  auto-bumped on every write, so no modification is skipped. Start with
  `updated_since`, then follow `next_cursor`. **Key rows by `id`** (idempotent
  upsert) — a row reappears when it changes.

```bash
# First pull from a point in time
curl -s "$ADVERTISELY_API_BASE_URL/api/external/leads?limit=100&updated_since=2026-09-01T00:00:00.000Z" \
  -H "Authorization: Bearer $ADVERTISELY_API_KEY"
# Continue
curl -s "$ADVERTISELY_API_BASE_URL/api/external/leads?limit=100&cursor=$ADVERTISELY_CURSOR" \
  -H "Authorization: Bearer $ADVERTISELY_API_KEY"
```

Response: `{ ok, leads: [...], count, next_cursor, has_more, max_page_size }`.
Each lead returns the full documented field set (nulls rather than omissions):
`id, account_id, organization_id, first_name, last_name, full_name, email, phone,
status, pipeline_id, pipeline_name, stage_id, stage_name, source, campaign_id,
campaign_name, ad_set_id, ad_set_name, ad_id, ad_name, form_id, landing_page_url,
utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid,
assigned_user_id, assigned_user_name, conversion_status, conversion_date,
monetary_value, currency, created_at, updated_at`.

- **Deletion:** trashed/voided leads drop out of the feed (no tombstone yet). If
  a deletion feed is needed, it must be added deliberately.

## Conversions — capabilities

`GET /api/conversions` (scope `conversions:read`) supports: **pagination**
(opaque cursor via `?mode=sync`/`?cursor=`), **`updated_since`** incremental
filtering, a stable **`lead_id`** linkage (+ `conversion_id`/`event_id`),
**event type** (`event_type`) and **status**, **event/recorded time**
(`event_time`, RFC3339), **monetary value** (`value_decimal`) + **currency**
(`USD`), and **campaign/ad-set/ad** attribution (`campaignName`, `adsetId`,
`creativeId`, plus `utm*` and `fbclid`). Historical retention is full (no purge).
Webhooks: **not supported.**

## Read conversions

### Incremental sync (recommended)

Ordered by `(soldAt, id)` ascending. Store `next_cursor` and pass it back to get
only what's new. New conversions always append, so a stored cursor never skips
one.

```bash
# First pull (from the beginning, or from a point in time)
curl -s "$ADVERTISELY_API_BASE_URL/api/conversions?mode=sync&limit=200" \
  -H "Authorization: Bearer $ADVERTISELY_API_KEY"

# From a time
curl -s "$ADVERTISELY_API_BASE_URL/api/conversions?updated_since=2026-09-01T00:00:00Z&limit=200" \
  -H "Authorization: Bearer $ADVERTISELY_API_KEY"

# Continue with the cursor from the previous response
curl -s "$ADVERTISELY_API_BASE_URL/api/conversions?cursor=$ADVERTISELY_CURSOR&limit=200" \
  -H "Authorization: Bearer $ADVERTISELY_API_KEY"
```

Response:

```json
{
  "ok": true,
  "count": 1,
  "conversions": [ { "lead_id": "…", "conversion_id": "cv_…", "event_time": "2026-09-10T12:00:00.000Z", "value_decimal": "1200.00", "currency": "USD", "fbclid": "fb.1.…", "campaignName": "…", "adsetId": "…", "creativeId": "…" } ],
  "next_cursor": "eyJ0IjoiMjAyNi0wOS0xMFQxMjowMDowMC4wMDBaIiwiaWQiOiJhIn0",
  "has_more": true,
  "max_page_size": 1000
}
```

Loop until `has_more` is `false`, persist the final `next_cursor`, and resume
from it next time. **Key rows by `lead_id`/`conversion_id`** (idempotent upsert)
— a row may reappear if its conversion is re-reported.

### Legacy shape (unchanged)

No sync params → the original contract, for the existing connection:

```bash
curl -s "$ADVERTISELY_API_BASE_URL/api/conversions?status=converted&limit=200" \
  -H "Authorization: Bearer $ADVERTISELY_API_KEY"
# -> { "ok": true, "count": N, "conversions": [ … ], "next_cursor": null }
```

## Fields per conversion

| Field | Meaning |
|---|---|
| `lead_id` / `id` | Stable immutable lead ID |
| `conversion_id` / `event_id` | Stable dedup key (`cv_<leadId>`) |
| `event_type` | `Purchase` |
| `event_status` | `recorded` (converted) / `pending` |
| `event_time` | RFC 3339 UTC — when it converted (`soldAt`) |
| `captured_time` | RFC 3339 UTC — when the lead was captured (`receivedAt`) |
| `value_decimal` + `currency` | Annual premium, e.g. `"1200.00"` + `USD` |
| `fbclid` | Facebook click ID for CAPI matching |
| `campaignName`, `adsetId`, `creativeId` | Meta attribution |
| `utmSource`, `utmMedium`, `utmCampaign` | UTM attribution |
| `state`, `packageId`, `source` | Lead context |
| `name`, `email`, `phone` | Contact (for CAPI hashing / matching) |

## Errors

Shape: `{ "error": "<message>" }`.

| Code | When |
|---|---|
| 400 | Bad cursor, bad `updated_since`, bad JSON, batch size out of range |
| 401 | Missing/invalid key |
| 403 | Valid key, missing scope |
| 503 | Database unavailable |

## Limits & rules

- **Max page size:** 1000 (default 200).
- **Ordering:** `(soldAt, id)` ascending in sync mode; `soldAt` descending in
  legacy mode.
- **Incremental:** based on `soldAt`. A back-dated value correction that reuses
  the original conversion time will not re-surface (no `updatedAt` column yet).
  Full change-tracking would require adding `Lead.updatedAt`.
- **Rate limit:** none enforced yet. Poll at a sane interval (e.g. every few
  minutes) rather than continuously.
- **Deletion:** hard-deletes are not exposed as tombstones. If a deletion feed
  is needed, it must be added deliberately.

## Known gaps vs. a "complete" contract

These are honest limitations of the current data model, not oversights:

- No per-row `updatedAt` → no refund/void/correction change feed.
- No dedicated conversions table → one conversion per lead; `conversion_id` is
  derived from the lead ID.
- No rate-limit headers or request/correlation IDs yet.

## Not part of this API

`GET /api/leads` is **browser-session only** (NextAuth cookie), org-scoped for
the CRM UI. It does not accept an API key. A dedicated read-only lead endpoint
would be a separate, approved addition.
