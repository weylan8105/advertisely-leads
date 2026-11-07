import { prisma } from "./prisma";
import { flattenMetaFields, META_LEAD_FIELDS, type MetaLeadDetail } from "./meta";
import { leadFormTokens } from "./metaAds";
import { ghlFormId } from "./inboundLead";

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v20.0"}`;

// Meta's own id for a form lead. Sending a wrong one gets the event rejected, so
// anything else (GHL contact ids, say) never goes out as a lead_id.
const META_LEAD_ID = /^\d{15,17}$/;
// Meta keeps form leads for 90 days.
const MAX_LOOKUP_AGE_MS = 90 * 86_400_000;
// GHL can forward a lead a while after the form was submitted.
const SUBMIT_SLACK_MS = 86_400_000;
const LOOKUP_BUDGET_MS = 6000;

type LeadForLookup = {
  id: string;
  externalId?: string | null;
  source?: string | null;
  email?: string | null;
  phone?: string | null;
  receivedAt?: Date | string | null;
  rawFormData?: unknown;
} & LeadAdColumns;

export type LeadAdColumns = {
  campaignName?: string | null;
  utmCampaign?: string | null;
  adsetId?: string | null;
  creativeId?: string | null;
};

type LeadAd = Pick<MetaLeadDetail, "ad_id" | "adset_id" | "campaign_id" | "campaign_name">;

/**
 * What a CRM event needs to know about an instant form lead. `note` says how the
 * lead id lookup went, for the meta-capi log.
 */
export interface InstantFormContext {
  leadId?: string;
  note: string;
}

/** Every lead on a form created after `since`, following pagination. */
export async function listFormLeads(formId: string, token: string, since: Date): Promise<MetaLeadDetail[]> {
  const qs = new URLSearchParams({
    fields: META_LEAD_FIELDS,
    filtering: JSON.stringify([
      { field: "time_created", operator: "GREATER_THAN", value: Math.floor(since.getTime() / 1000) },
    ]),
    limit: "100",
    access_token: token,
  });
  let url: string | null = `${GRAPH}/${encodeURIComponent(formId)}/leads?${qs}`;
  const out: MetaLeadDetail[] = [];
  while (url && out.length < 2000) {
    const res: Response = await fetch(url, { cache: "no-store" });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      throw new Error(data?.error?.message ?? `Graph API ${res.status}`);
    }
    out.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return out;
}

/** The campaign and ad Meta has on file for a form lead. */
async function fetchLeadAd(leadId: string, token: string): Promise<LeadAd> {
  const qs = new URLSearchParams({ fields: "ad_id,adset_id,campaign_id,campaign_name", access_token: token });
  const res = await fetch(`${GRAPH}/${encodeURIComponent(leadId)}?${qs}`, { cache: "no-store" });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Graph API ${res.status}`);
  return data;
}

/** What Meta can add to this lead's ad columns. Anything already set stays. */
export function adColumnsToFill(lead: LeadAdColumns, ad: LeadAd): LeadAdColumns {
  const fill: LeadAdColumns = {};
  if (!lead.campaignName && ad.campaign_name) fill.campaignName = ad.campaign_name;
  if (!lead.utmCampaign && ad.campaign_name) fill.utmCampaign = ad.campaign_name;
  if (!lead.adsetId && ad.adset_id) fill.adsetId = ad.adset_id;
  if (!lead.creativeId && ad.ad_id) fill.creativeId = ad.ad_id;
  return fill;
}

const rawWithAd = (raw: Record<string, string>, ad: LeadAd | null) =>
  ad?.campaign_id ? { ...raw, campaignId: ad.campaign_id } : raw;

function isSamePerson(detail: MetaLeadDetail, email?: string | null, phone?: string | null): boolean {
  const wantEmail = email?.trim().toLowerCase();
  const wantPhone = phone?.replace(/\D/g, "").slice(-10);
  return Object.values(flattenMetaFields(detail.field_data ?? [])).some(
    (v) =>
      (!!wantEmail && v.toLowerCase() === wantEmail) ||
      (wantPhone?.length === 10 && v.replace(/\D/g, "").slice(-10) === wantPhone),
  );
}

/** The same person can submit a form twice; take the submission nearest this lead. */
function closestMatch(leads: MetaLeadDetail[], lead: LeadForLookup, receivedMs: number): MetaLeadDetail | undefined {
  const gap = (l: MetaLeadDetail) => Math.abs(new Date(l.created_time).getTime() - receivedMs);
  return leads
    .filter((l) => META_LEAD_ID.test(l.id) && isSamePerson(l, lead.email, lead.phone))
    .sort((a, b) => gap(a) - gap(b))[0];
}

async function lookUpLeadId(
  lead: LeadForLookup,
  formId: string,
  raw: Record<string, string>,
): Promise<InstantFormContext> {
  const receivedMs = lead.receivedAt ? new Date(lead.receivedAt).getTime() : Date.now();
  if (Date.now() - receivedMs > MAX_LOOKUP_AGE_MS) return { note: "id:too-old" };

  const tokens = await leadFormTokens(formId);
  if (tokens.length === 0) return { note: "id:no-access" };

  let reachedForm = false;
  for (const token of tokens) {
    let leads: MetaLeadDetail[];
    try {
      leads = await listFormLeads(formId, token, new Date(receivedMs - SUBMIT_SLACK_MS));
    } catch {
      continue; // this token's Page doesn't own the form
    }
    reachedForm = true;
    const match = closestMatch(leads, lead, receivedMs);
    if (match) {
      // GHL stopped sending the campaign and ad on Nov 5, 2026, so they come from Meta.
      const ad = lead.campaignName && lead.creativeId ? null : await fetchLeadAd(match.id, token).catch(() => match);
      await prisma?.lead
        .update({
          where: { id: lead.id },
          data: { rawFormData: { ...rawWithAd(raw, ad), leadgen_id: match.id }, ...(ad ? adColumnsToFill(lead, ad) : {}) },
        })
        .catch(() => {});
      return { leadId: match.id, note: "id:found" };
    }
  }
  return { note: reachedForm ? "id:not-found" : "id:no-access" };
}

const rawOf = (lead: LeadForLookup) =>
  (lead.rawFormData && typeof lead.rawFormData === "object" ? lead.rawFormData : {}) as Record<string, string>;
const formIdOf = (raw: Record<string, string>) => ghlFormId(raw) || raw["form_id"] || raw["leadgen_form_id"] || "";

/**
 * Fill a lead's blank ad columns from the Meta lead id already stored on it, for
 * leads that got their id before the columns were filled at intake. `dryRun`
 * reads without writing. Returns what Meta could fill, or why it couldn't.
 */
export async function fillLeadAd(
  lead: LeadForLookup,
  { dryRun = false } = {},
): Promise<{ fill: LeadAdColumns; error?: string }> {
  const raw = rawOf(lead);
  const formId = formIdOf(raw);
  if (!raw["leadgen_id"] || !formId) return { fill: {}, error: "no lead or form id" };

  let error: string | undefined;
  for (const token of await leadFormTokens(formId)) {
    let ad: LeadAd;
    try {
      ad = await fetchLeadAd(raw["leadgen_id"], token);
    } catch (e) {
      error = (e as Error).message;
      continue; // this token's Page doesn't own the form
    }
    const fill = adColumnsToFill(lead, ad);
    if (Object.keys(fill).length === 0) continue;
    if (!dryRun) await prisma?.lead.update({ where: { id: lead.id }, data: { ...fill, rawFormData: rawWithAd(raw, ad) } });
    return { fill };
  }
  return { fill: {}, error };
}

/**
 * Instant form details for a CRM event, or null when the lead isn't ours to report
 * that way (a website lead, or a form that belongs to an advertiser).
 *
 * GHL forwards form leads with its own contact id, so Meta's lead id is looked up
 * from the form by email/phone and kept in rawFormData. The lookup is best effort
 * and capped at `budgetMs`: Meta also matches on the hashed email and phone, so
 * the event still goes out without it, and the next stage move tries again.
 */
export async function instantFormContext(
  lead: LeadForLookup,
  budgetMs = LOOKUP_BUDGET_MS,
): Promise<InstantFormContext | null> {
  const raw = rawOf(lead);
  const formId = formIdOf(raw);
  if (!formId && !/^(facebook|meta - )/i.test(lead.source ?? "")) return null;

  if (formId) {
    const mapping = await prisma?.metaFormMapping.findUnique({ where: { formId }, select: { ownerUserId: true } });
    if (mapping?.ownerUserId) return null;
  }

  const known = [raw["leadgen_id"], lead.externalId].find((id) => id && META_LEAD_ID.test(id));
  if (known) return { leadId: known, note: "id:stored" };
  if (!formId) return { note: "id:no-form" };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<InstantFormContext>((resolve) => {
    timer = setTimeout(() => resolve({ note: "id:timeout" }), budgetMs);
  });
  try {
    return await Promise.race([lookUpLeadId(lead, formId, raw).catch(() => ({ note: "id:error" })), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
