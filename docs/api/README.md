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
