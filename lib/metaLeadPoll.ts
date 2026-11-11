import { prisma } from "./prisma";
import { fetchMetaFormQuestions, flattenMetaFields, suggestFieldMapping, type MetaLeadDetail } from "./meta";
import { ingestLeadFromFields, type IngestResult } from "./leadIngest";
import { listLeadForms, systemUserPageToken } from "./metaAds";
import { listFormLeads } from "./metaLeadId";
import { isEmailConfigured, sendUnlinkedFormsEmail } from "./email";

// How far back each poll looks. Re-reading leads we already have is free
// (ingest is idempotent on the leadgen id), and the overlap lets a missed or
// failed run catch up on the next one.
export const POLL_LOOKBACK_HOURS = 48;
// Placeholder until an admin links the form and picks its real package.
const DEFAULT_PACKAGE_ID = "blue-collar-iul";

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
      campaignName: detail.campaign_name,
      formId: mapping.formId,
      adsetId: detail.adset_id,
      adsetName: detail.adset_name,
      adId: detail.ad_id,
      adName: detail.ad_name,
      createdTime: new Date(detail.created_time),
    },
    activityBody: `Lead received from Meta form "${mapping.formName}".`,
  });
}

const lookbackStart = () => new Date(Date.now() - POLL_LOOKBACK_HOURS * 3600_000);

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
 * `since` and `formId` narrow it to one form when that form is first linked.
 */
export async function pollMetaLeads(
  opts: { dryRun?: boolean; formId?: string; since?: Date } = {},
): Promise<FormPollResult[]> {
  if (!prisma) return [];
  const since = opts.since ?? lookbackStart();
  const mappings = await prisma.metaFormMapping.findMany({
    where: { enabled: true, pageConnection: { enabled: true }, ...(opts.formId ? { formId: opts.formId } : {}) },
    include: { pageConnection: true },
  });

  const results: FormPollResult[] = [];
  const tokens = new Map<string, string | null>();
  for (const mapping of mappings) {
    const r: FormPollResult = { formId: mapping.formId, formName: mapping.formName, found: 0, ingested: 0, duplicates: 0, skipped: 0 };
    results.push(r);
    try {
      const pageId = mapping.pageConnection.pageId;
      if (!tokens.has(pageId)) tokens.set(pageId, await systemUserPageToken(pageId));
      const token = tokens.get(pageId) ?? mapping.pageConnection.pageAccessToken;
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

export interface UnlinkedForm {
  formId: string;
  formName: string;
  pageName: string;
  leads: number;
}

type ConnectedPage = { id: string; pageId: string; pageName: string };

/**
 * Save a form that's getting leads, switched off, with its fields suggested.
 * Null when it's already saved, so two leads at once can't alert twice.
 */
async function saveUnlinkedForm(page: ConnectedPage, formId: string, token: string): Promise<UnlinkedForm | null> {
  const { name, questions } = await fetchMetaFormQuestions(formId, token);
  const formName = name ?? formId;
  const { count } = await prisma!.metaFormMapping.createMany({
    data: [
      {
        formId,
        formName,
        packageId: DEFAULT_PACKAGE_ID,
        pageConnectionId: page.id,
        enabled: false,
        fieldMapping: suggestFieldMapping(questions),
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) return null;
  const leads = await listFormLeads(formId, token, lookbackStart());
  return { formId, formName, pageName: page.pageName, leads: leads.length };
}

async function alertAdmins(forms: UnlinkedForm[]) {
  if (forms.length === 0 || !isEmailConfigured) return;
  for (const toEmail of await adminEmails()) {
    await sendUnlinkedFormsEmail({ toEmail, forms }).catch((err) =>
      console.error(`Meta: unlinked form email failed: ${(err as Error).message}`),
    );
  }
}

/** The webhook's version of findUnlinkedForms, for a lead on a form nobody linked. */
export async function flagUnlinkedForm(pageId: string, formId: string): Promise<UnlinkedForm | null> {
  if (!prisma) return null;
  const page = await prisma.metaPageConnection.findUnique({ where: { pageId } });
  if (!page?.enabled) return null;
  const token = (await systemUserPageToken(pageId)) ?? page.pageAccessToken;
  const form = await saveUnlinkedForm(page, formId, token);
  if (form) await alertAdmins([form]);
  return form;
}

async function adminEmails(): Promise<string[]> {
  const admins = await prisma!.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const fromEnv = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim());
  return Array.from(
    new Map([...admins.map((u) => u.email), ...fromEnv].filter(Boolean).map((e) => [e.toLowerCase(), e])).values(),
  );
}

/**
 * Find forms on connected Pages that are collecting leads but aren't linked to
 * anyone, so a new form can't lose leads unnoticed. Each is saved switched off
 * with its fields suggested, for an admin to link under Meta ingestion: only a
 * person can say whose leads they are, and a guess could hand a client's leads
 * to someone else. Admins get one email per form, when it's first found.
 */
export async function findUnlinkedForms(): Promise<UnlinkedForm[]> {
  if (!prisma) return [];
  const pages = await prisma.metaPageConnection.findMany({ where: { enabled: true } });
  const known = new Set((await prisma.metaFormMapping.findMany({ select: { formId: true } })).map((m) => m.formId));
  const found: UnlinkedForm[] = [];

  for (const page of pages) {
    try {
      const token = (await systemUserPageToken(page.pageId)) ?? page.pageAccessToken;
      for (const form of await listLeadForms(page.pageId)) {
        if (form.status !== "ACTIVE" || known.has(form.id)) continue;
        const leads = await listFormLeads(form.id, token, lookbackStart());
        if (leads.length === 0) continue;
        const saved = await saveUnlinkedForm(page, form.id, token);
        if (saved) found.push(saved);
      }
    } catch (err) {
      console.error(`Meta poll: form check on page ${page.pageId} failed: ${(err as Error).message.slice(0, 300)}`);
    }
  }

  await alertAdmins(found);
  return found;
}
