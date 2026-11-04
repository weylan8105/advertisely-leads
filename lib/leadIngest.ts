import { prisma } from "./prisma";
import { mapLeadFields } from "./meta";
import { tryFulfillForNewLead } from "./fulfillment";
import { deliverLeadToOwner } from "./house";
import { isTestLead } from "./testLeads";

export interface IngestResult {
  status: "ingested" | "skipped_duplicate" | "missing_fields";
  leadId?: string;
  assigned?: boolean;
  orderId?: string | null;
  missing?: string[];
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
    adId?: string;
    createdTime?: Date;
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

  const created = await prisma.lead.create({
    data: {
      externalId: opts.externalId,
      name: standardized.name!,
      phone: standardized.phone!,
      email: standardized.email ?? "",
      state: standardized.state ?? "",
      age: standardized.age,
      income: standardized.income,
      occupation: standardized.occupation,
      intentReason: standardized.intentReason,
      packageId: opts.packageId,
      source: opts.source,
      campaignName: opts.meta?.campaignId,
      adsetId: opts.meta?.adsetId,
      creativeId: opts.meta?.adId,
      consentMethod: "TCPA_WEB_FORM",
      consentTime: opts.meta?.createdTime ?? new Date(),
      rawFormData: raw,
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
