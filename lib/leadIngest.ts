import { prisma } from "./prisma";
import { mapLeadFields } from "./meta";
import { tryFulfillForNewLead } from "./fulfillment";
import { deliverLeadToOwner } from "./house";
import { fireMetaLeadEvent } from "./metaCapi";
import { isTestLead } from "./testLeads";

export interface IngestResult {
  status: "ingested" | "skipped_duplicate" | "missing_fields";
  leadId?: string;
  assigned?: boolean;
  orderId?: string | null;
  missing?: string[];
}

// GHL can forward a lead a while after the form was submitted.
const COPY_WINDOW_MS = 86_400_000;

/**
 * The same form submission already stored by the other intake path. GHL and Meta
 * give one lead different ids, so while a form moves off GHL they can both bring
 * it in. Matches on the form, phone and time, so someone who fills the form out
 * again later is still a new lead.
 */
export async function findFormLeadCopy(formId: string, phone: string, around: Date) {
  const digits = phone.replace(/\D/g, "").slice(-10);
  if (!prisma || digits.length < 10) return null;
  const rows = await prisma.$queryRaw<{ id: string; rawFormData: Record<string, unknown> | null }[]>`
    SELECT id, "rawFormData" FROM "Lead"
    WHERE "receivedAt" BETWEEN ${new Date(around.getTime() - COPY_WINDOW_MS)} AND ${new Date(around.getTime() + COPY_WINDOW_MS)}
      AND right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = ${digits}
      AND "rawFormData"::text LIKE ${`%${formId}%`}
    LIMIT 1`;
  return rows[0] ?? null;
}

/**
 * The single canonical path for turning a flattened lead form submission into a
 * stored, fulfilled Lead. Shared by the Meta webhook (real leads) and the admin
 * simulate endpoint (test leads) so both exercise identical logic — mapping,
 * state normalization, required-field validation, idempotency, and fulfillment.
 */
export async function ingestLeadFromFields(opts: {
  externalId: string;
  flat: Record<string, string>;
  fieldMapping: Record<string, string>;
  packageId: string;
  // When set (from the form mapping's ownerUserId), the lead is delivered
  // straight to this user's CRM and NEVER distributed to the marketplace.
  ownerUserId?: string | null;
  source: string;
  meta?: {
    campaignId?: string;
    adsetId?: string;
    adsetName?: string;
    adId?: string;
    adName?: string;
    createdTime?: Date;
    campaignName?: string;
    formId?: string;
  };
  activityBody: string;
}): Promise<IngestResult> {
  if (!prisma) return { status: "missing_fields", missing: ["database"] };

  // Idempotency — never double-insert the same source lead.
  const existing = await prisma.lead.findUnique({
    where: { externalId: opts.externalId },
  });
  if (existing) {
    return {
      status: "skipped_duplicate",
      leadId: existing.id,
      assigned: !!existing.assignedUserId,
      orderId: existing.orderId,
    };
  }

  const { standardized, raw } = mapLeadFields(opts.flat, opts.fieldMapping);

  // State only matters for matching marketplace orders. An advertiser's own form
  // often doesn't ask it, and those leads go straight to the owner, so don't
  // drop them for lacking one.
  const missing: string[] = [];
  if (!standardized.name) missing.push("name");
  if (!standardized.phone) missing.push("phone");
  if (!standardized.state && !opts.ownerUserId) missing.push("state");
  if (missing.length > 0) {
    return { status: "missing_fields", missing };
  }

  const formId = opts.meta?.formId;
  if (formId) {
    const copy = await findFormLeadCopy(formId, standardized.phone!, opts.meta?.createdTime ?? new Date());
    if (copy) {
      if (!copy.rawFormData?.leadgen_id) {
        await prisma.lead.update({
          where: { id: copy.id },
          data: { rawFormData: { ...(copy.rawFormData as object), leadgen_id: opts.externalId } },
        });
      }
      return { status: "skipped_duplicate", leadId: copy.id };
    }
  }

  const created = await prisma.lead.create({
    data: {
      externalId: opts.externalId,
      name: standardized.name!,
      phone: standardized.phone!,
      email: standardized.email ?? "",
      state: standardized.state ?? "",
      zip: standardized.zip,
      age: standardized.age,
      income: standardized.income,
      occupation: standardized.occupation,
      intentReason: standardized.intentReason,
      packageId: opts.packageId,
      source: opts.source,
      campaignName: opts.meta?.campaignName,
      utmCampaign: opts.meta?.campaignName,
      adsetId: opts.meta?.adsetId,
      adsetName: opts.meta?.adsetName,
      creativeId: opts.meta?.adId,
      adName: opts.meta?.adName,
      consentMethod: "TCPA_WEB_FORM",
      consentTime: opts.meta?.createdTime ?? new Date(),
      // The form and campaign ids are what CRM events and Ad Performance read.
      rawFormData: formId
        ? { ...raw, form_id: formId, leadgen_id: opts.externalId, ...(opts.meta?.campaignId ? { campaignId: opts.meta.campaignId } : {}) }
        : raw,
      activity: {
        create: {
          type: "LEAD_RECEIVED",
          body: opts.activityBody,
        },
      },
    },
  });

  // Auto-trash test/internal identities on intake — never deliver or fulfill.
  if (isTestLead(created.name, created.email)) {
    await prisma.lead.update({
      where: { id: created.id },
      data: { trashedAt: new Date() },
    });
    await prisma.leadActivity.create({
      data: {
        leadId: created.id,
        type: "LEAD_RECEIVED",
        body: "Auto-trashed on intake — test/internal identity.",
      },
    });
    return { status: "ingested", leadId: created.id, assigned: false, orderId: null };
  }

  // Advertiser-owned form: this lead belongs solely to the form's owner. Deliver
  // it straight into their CRM and skip marketplace distribution entirely — it
  // can never land in the sellable bank or on any buyer's order.
  if (opts.ownerUserId) {
    const delivered = await deliverLeadToOwner(
      created.id,
      opts.ownerUserId,
      `Delivered to advertiser (owns form "${opts.source}") — not distributed to buyers.`,
    );
    return { status: "ingested", leadId: created.id, assigned: delivered, orderId: null };
  }

  // Same order as the inbound path: tell Meta first, so a failed assignment below
  // can't lose the event. Admin simulations have no Meta lead to report.
  if (opts.meta) {
    try {
      await fireMetaLeadEvent(created);
    } catch (err) {
      console.warn(`[meta-capi] lead ${created.id}: ${(err as Error).message}`);
    }
  }

  // Try to immediately assign to an open order (sends email + Sheets sync).
  await tryFulfillForNewLead(created.id);

  // Re-read to report whether it actually landed on an order.
  const after = await prisma.lead.findUnique({
    where: { id: created.id },
    select: { assignedUserId: true, orderId: true },
  });

  return {
    status: "ingested",
    leadId: created.id,
    assigned: !!after?.assignedUserId,
    orderId: after?.orderId ?? null,
  };
}
