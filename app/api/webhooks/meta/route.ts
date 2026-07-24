import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import {
  verifyMetaSignature,
  fetchMetaLeadDetail,
  flattenMetaFields,
  type MetaLeadgenWebhookPayload,
} from "@/lib/meta";
import { ingestLeadFromFields } from "@/lib/leadIngest";

// Force this route to run in Node.js runtime (not Edge) — Prisma requires Node.
export const runtime = "nodejs";
// Don't cache webhook responses, always run fresh.
export const dynamic = "force-dynamic";

/**
 * GET — Meta verification challenge.
 * When you first configure the webhook, Meta sends a GET with `hub.challenge`
 * and `hub.verify_token`. We echo the challenge back if the verify token matches.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token === process.env.META_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * POST — leadgen webhook delivery.
 * Meta sends an event with the leadgen_id; we fetch full lead detail
 * from Graph API, persist to DB, and trigger fulfillment.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return NextResponse.json(
      { error: "META_APP_SECRET not configured" },
      { status: 503 },
    );
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  if (!verifyMetaSignature(rawBody, signature, appSecret)) {
    console.warn("Meta webhook: invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: MetaLeadgenWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.object !== "page") {
    return NextResponse.json({ ok: true, skipped: "not page" });
  }

  const ingested: string[] = [];
  const skipped: string[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen") continue;
      const event = change.value;

      // Find the form mapping → tells us which package + page access token to use
      const formMapping = await prisma.metaFormMapping.findUnique({
        where: { formId: event.form_id },
        include: { pageConnection: true },
      });

      if (!formMapping || !formMapping.enabled) {
        skipped.push(event.leadgen_id);
        console.log(
          `Meta webhook: no enabled mapping for form ${event.form_id}, skipping`,
        );
        continue;
      }
      if (!formMapping.pageConnection.pageAccessToken) {
        skipped.push(event.leadgen_id);
        continue;
      }

      try {
        const detail = await fetchMetaLeadDetail(
          event.leadgen_id,
          formMapping.pageConnection.pageAccessToken,
        );
        const flat = flattenMetaFields(detail.field_data);
        const fieldMapping =
          (formMapping.fieldMapping as Record<string, string>) ?? {};

        const result = await ingestLeadFromFields({
          externalId: event.leadgen_id,
          flat,
          fieldMapping,
          packageId: formMapping.packageId,
          source: `Meta - ${formMapping.formName}`,
          meta: {
            campaignId: detail.campaign_id,
            adsetId: detail.adset_id,
            adId: detail.ad_id,
            createdTime: new Date(detail.created_time),
          },
          activityBody: `Lead received from Meta form "${formMapping.formName}".`,
        });

        if (result.status === "ingested") {
          ingested.push(event.leadgen_id);
        } else {
          if (result.status === "missing_fields") {
            console.warn(
              `Meta webhook: skipping ${event.leadgen_id} - missing required fields (${result.missing?.join(", ")})`,
            );
          }
          skipped.push(event.leadgen_id);
        }
      } catch (err) {
        console.error("Meta webhook ingest failed:", err);
        skipped.push(event.leadgen_id);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    ingested: ingested.length,
    skipped: skipped.length,
  });
}
