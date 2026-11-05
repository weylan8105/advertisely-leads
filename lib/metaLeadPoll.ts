import { prisma } from "./prisma";
import { flattenMetaFields, type MetaLeadDetail } from "./meta";
import { ingestLeadFromFields, type IngestResult } from "./leadIngest";
import { systemUserPageToken } from "./metaAds";
import { listFormLeads } from "./metaLeadId";

// How far back each poll looks. Re-reading leads we already have is free
// (ingest is idempotent on the leadgen id), and the overlap lets a missed or
// failed run catch up on the next one.
export const POLL_LOOKBACK_HOURS = 48;

type MappingWithPage = {
  formId: string;
  formName: string;
  packageId: string;
  ownerUserId: string | null;
  fieldMapping: unknown;
  pageConnection: { pageId: string; pageAccessToken: string };
};

/**
 * Store one Meta lead for a form mapping. Shared by the leadgen webhook (which
 * fetches the lead by id) and the poller (which lists them per form), so both
 * map fields, route to the form's owner, and dedupe identically.
 */
export function ingestMetaLead(mapping: MappingWithPage, detail: MetaLeadDetail): Promise<IngestResult> {
  return ingestLeadFromFields({
    externalId: detail.id,
    flat: flattenMetaFields(detail.field_data ?? []),
    fieldMapping: (mapping.fieldMapping as Record<string, string>) ?? {},
    packageId: mapping.packageId,
    ownerUserId: mapping.ownerUserId,
    source: `Meta - ${mapping.formName}`,
    meta: {
      campaignId: detail.campaign_id,
      adsetId: detail.adset_id,
      adId: detail.ad_id,
      createdTime: new Date(detail.created_time),
    },
    activityBody: `Lead received from Meta form "${mapping.formName}".`,
  });
}

export interface FormPollResult {
  formId: string;
  formName: string;
  found: number;
  ingested: number;
  duplicates: number;
  skipped: number;
  error?: string;
  // Dry runs only: what would be ingested, without any lead contents.
  leads?: Array<{ id: string; createdTime: string; known: boolean }>;
}

/**
 * Pull recent leads for every enabled form mapping straight from the Graph API.
 * This is how leads arrive while the app's leadgen webhook can't be enabled
 * (it needs Advanced Access); with the webhook on, it's a harmless backstop.
 */
export async function pollMetaLeads(opts: { dryRun?: boolean; lookbackHours?: number } = {}): Promise<FormPollResult[]> {
  if (!prisma) return [];
  const since = new Date(Date.now() - (opts.lookbackHours ?? POLL_LOOKBACK_HOURS) * 3600_000);
  const mappings = await prisma.metaFormMapping.findMany({
    where: { enabled: true, pageConnection: { enabled: true } },
    include: { pageConnection: true },
  });

  const results: FormPollResult[] = [];
  for (const mapping of mappings) {
    const r: FormPollResult = { formId: mapping.formId, formName: mapping.formName, found: 0, ingested: 0, duplicates: 0, skipped: 0 };
    results.push(r);
    try {
      const token =
        (await systemUserPageToken(mapping.pageConnection.pageId)) ?? mapping.pageConnection.pageAccessToken;
      const leads = await listFormLeads(mapping.formId, token, since);
      r.found = leads.length;

      if (opts.dryRun) {
        const known = new Set(
          (
            await prisma.lead.findMany({
              where: { externalId: { in: leads.map((l) => l.id) } },
              select: { externalId: true },
            })
          ).map((l) => l.externalId),
        );
        r.leads = leads.map((l) => ({ id: l.id, createdTime: l.created_time, known: known.has(l.id) }));
        continue;
      }

      for (const lead of leads) {
        const out = await ingestMetaLead(mapping, lead);
        if (out.status === "ingested") r.ingested++;
        else if (out.status === "skipped_duplicate") r.duplicates++;
        else {
          r.skipped++;
          console.warn(`Meta poll: lead ${lead.id} on form ${mapping.formId} missing ${out.missing?.join(", ")}`);
        }
      }
    } catch (err) {
      r.error = (err as Error).message.slice(0, 300);
      console.error(`Meta poll: form ${mapping.formId} failed: ${r.error}`);
    }
  }
  return results;
}
