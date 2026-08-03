import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { addTagToGHLContact, platformGHLConfig } from "@/lib/ghl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/[id]/sold
 *
 * An agent marks a lead as SOLD (they converted it to a policy). This:
 *  - stamps `ghlSoldTaggedAt` so the lead leaves the sellable pool (the resale
 *    engine excludes sold leads),
 *  - sets status CLOSED / disposition "sold",
 *  - tags the GHL contact `advertisely-sold` so Enhanced Wealth pulls it out of
 *    the dialing view.
 *
 * Scoped to the lead's assigned agent (or an ADMIN).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = (session.user as any).id as string;
  const isAdmin = (session.user as any).role === "ADMIN";

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, assignedUserId: true, ghlContactId: true, ghlSoldTaggedAt: true },
  });
  if (!lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }
  if (!isAdmin && lead.assignedUserId !== userId) {
    return NextResponse.json({ error: "Not your lead" }, { status: 403 });
  }
  if (lead.ghlSoldTaggedAt) {
    return NextResponse.json({ ok: true, alreadySold: true });
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ghlSoldTaggedAt: new Date(),
      status: "CLOSED",
      disposition: "sold",
      activity: {
        create: {
          type: "STATUS_CHANGED",
          body: `Marked SOLD${isAdmin ? " by admin" : ""} — removed from sellable pool.`,
        },
      },
    },
  });

  // Tag the GHL contact so Enhanced Wealth stops dialing it. Never block the
  // sold-marking on a GHL failure — the pool exclusion is the source of truth.
  let ghlTagged = false;
  let ghlError: string | undefined;
  const cfg = platformGHLConfig();
  if (lead.ghlContactId && cfg) {
    const res = await addTagToGHLContact(lead.ghlContactId, ["advertisely-sold"], cfg);
    ghlTagged = res.ok;
    if (!res.ok) ghlError = res.error;
  }

  return NextResponse.json({ ok: true, ghlTagged, ghlError });
}
