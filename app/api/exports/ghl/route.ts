import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { pushContactToGHL, splitName, type GHLConfig } from "@/lib/ghl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Push selected leads to the signed-in customer's GoHighLevel account.
 * Body: { leadIds: string[] }
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { leadIds: string[] };
  if (!body.leadIds || body.leadIds.length === 0) {
    return NextResponse.json(
      { error: "leadIds array required" },
      { status: 400 },
    );
  }

  const integration = await prisma.integration.findUnique({
    where: {
      userId_type: { userId: (session.user as any).id, type: "GOHIGHLEVEL" },
    },
  });
  if (!integration || !integration.enabled) {
    return NextResponse.json(
      { error: "GoHighLevel is not connected. Go to Settings → Integrations." },
      { status: 400 },
    );
  }
  const cfg = integration.config as unknown as GHLConfig;

  const leads = await prisma.lead.findMany({
    where: {
      id: { in: body.leadIds },
      assignedUserId: (session.user as any).id, // only the customer's own leads
    },
  });

  const results = [] as Array<{ leadId: string; ok: boolean; error?: string }>;

  for (const lead of leads) {
    const { firstName, lastName } = splitName(lead.name);
    const result = await pushContactToGHL(
      {
        locationId: cfg.locationId,
        firstName,
        lastName,
        email: lead.email,
        phone: lead.phone,
        source: `Advertisely - ${lead.source}`,
        state: lead.state,
        tags: ["advertisely-lead", ...lead.tags],
        customFields: [
          { key: "advertisely_lead_id", field_value: lead.id },
          { key: "lead_intent_reason", field_value: lead.intentReason ?? "" },
          { key: "lead_occupation", field_value: lead.occupation ?? "" },
        ],
      },
      cfg,
    );

    await prisma.exportLog.create({
      data: {
        userId: (session.user as any).id,
        leadId: lead.id,
        destination: "ghl",
        status: result.ok ? "SUCCESS" : "FAILED",
        responseCode: result.status,
        errorMessage: result.error,
      },
    });

    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "EXPORTED_CRM",
        author: session.user.name ?? undefined,
        body: result.ok
          ? "Pushed to GoHighLevel."
          : `GHL push failed: ${result.error ?? "unknown error"}.`,
      },
    });

    results.push({ leadId: lead.id, ok: result.ok, error: result.error });
  }

  await prisma.integration.update({
    where: { id: integration.id },
    data: { lastUsedAt: new Date() },
  });

  const success = results.filter((r) => r.ok).length;
  return NextResponse.json({
    pushed: success,
    failed: results.length - success,
    results,
  });
}
