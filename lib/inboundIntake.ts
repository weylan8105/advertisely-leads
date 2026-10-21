import { prisma } from "@/lib/prisma";
import type { NormalizedInboundLead } from "@/lib/inboundLead";
import { tryFulfillForNewLead } from "@/lib/fulfillment";
import { fireMetaLeadEvent } from "@/lib/metaCapi";
import { isTestLead } from "@/lib/testLeads";

export type InboundLeadOutcome =
  | { status: "created"; leadId: string; error?: string } // error = post-create side effect failed
  | { status: "duplicate" }
  | { status: "test"; leadId: string }
  | { status: "no-phone" }
  | { status: "failed"; error: string };

/**
 * Store one normalized inbound lead and push it through the normal pipeline:
 * idempotency on externalId, test-identity auto-trash, fulfillment (assignment
 * -> delivery email -> Google Sheets) and the server-side Meta "Lead" event.
 *
 * Shared by the keyed connector webhook (/api/webhooks/inbound) and the public
 * quiz intake route (/api/quiz/submit) so both create leads identically.
 */
export async function createInboundLead(
  lead: NormalizedInboundLead,
  opts: { activityBody: string; consentIp?: string },
): Promise<InboundLeadOutcome> {
  if (!prisma) return { status: "failed", error: "Database not configured." };

  // A lead we can't contact is worse than none — require a phone.
  if (!lead.standardized.phone) return { status: "no-phone" };

  // Idempotency when the connector supplies a stable id.
  if (lead.externalId) {
    const existing = await prisma.lead.findUnique({
      where: { externalId: lead.externalId },
    });
    if (existing) return { status: "duplicate" };
  }

  let record;
  try {
    record = await prisma.lead.create({
      data: {
        externalId: lead.externalId,
        name: lead.standardized.name,
        phone: lead.standardized.phone,
        email: lead.standardized.email,
        state: lead.standardized.state,
        zip: lead.standardized.zip,
        age: lead.standardized.age,
        income: lead.standardized.income,
        occupation: lead.standardized.occupation,
        intentReason: lead.standardized.intentReason,
        packageId: lead.packageId,
        source: lead.source,
        tags: lead.tags,
        campaignName: lead.attribution.campaignName,
        adsetId: lead.attribution.adsetId,
        creativeId: lead.attribution.creativeId,
        utmSource: lead.attribution.utmSource,
        utmMedium: lead.attribution.utmMedium,
        utmCampaign: lead.attribution.utmCampaign,
        fbclid: lead.attribution.fbclid,
        consentTime: new Date(),
        consentIp: opts.consentIp ?? (lead.raw["consent_ip"] || undefined),
        rawFormData: lead.raw,
        activity: {
          create: {
            type: "LEAD_RECEIVED",
            body: opts.activityBody,
          },
        },
      },
    });
    // Auto-trash test/internal identities on intake — never deliver, count,
    // or fire a conversion event for them.
    if (isTestLead(record.name, record.email)) {
      await prisma.lead.update({
        where: { id: record.id },
        data: { trashedAt: new Date() },
      });
      await prisma.leadActivity.create({
        data: {
          leadId: record.id,
          type: "LEAD_RECEIVED",
          body: "Auto-trashed on intake — test/internal identity.",
        },
      });
      return { status: "test", leadId: record.id };
    }
  } catch (err) {
    return { status: "failed", error: (err as Error).message.slice(0, 200) };
  }

  try {
    // Assign to an open order immediately (fires email + Sheets sync).
    await tryFulfillForNewLead(record.id);
    // Server-side Meta "Lead" event (deduped with the browser pixel).
    await fireMetaLeadEvent(record);
  } catch (err) {
    return { status: "created", leadId: record.id, error: (err as Error).message.slice(0, 200) };
  }
  return { status: "created", leadId: record.id };
}
