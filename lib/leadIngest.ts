import { prisma } from "./prisma";
import { mapLeadFields } from "./meta";
import { tryFulfillForNewLead } from "./fulfillment";

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

  const missing: string[] = [];
  if (!standardized.name) missing.push("name");
  if (!standardized.phone) missing.push("phone");
  if (!standardized.state) missing.push("state");
  if (missing.length > 0) {
    return { status: "missing_fields", missing };
  }

  const created = await prisma.lead.create({
    data: {
      externalId: opts.externalId,
      name: standardized.name!,
      phone: standardized.phone!,
      email: standardized.email ?? "",
      state: standardized.state!,
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
