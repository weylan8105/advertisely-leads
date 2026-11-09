import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { canActOnLead } from "@/lib/leadAccess";
import { DIAL_CAP, DIAL_VIAS, SAME_CALL_MS, dialAction } from "@/lib/dials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leads/:id/dial — log a dial (see lib/dials.ts).
 * Body: { via: "copy" | "call" | "talking" }
 * Returns { ok, counted }; counted is false when this wasn't a new dial.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { via?: unknown };
  const via = DIAL_VIAS.find((v) => v === body.via);
  if (!via) return NextResponse.json({ error: "Invalid via" }, { status: 400 });

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, assignedUserId: true, organizationId: true, pipeline: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  // An admin looking through a client's leads isn't dialing them, and an upline
  // clicking a downline's card is only reviewing it.
  const mayDial = await canActOnLead(userId, false, lead);
  const worksLead = lead.assignedUserId === userId || lead.pipeline === "goldmine";
  if (!mayDial || (via === "talking" && !worksLead)) return NextResponse.json({ ok: true, counted: false });

  const now = new Date();
  const recent = await prisma.leadActivity.findMany({
    where: {
      leadId: lead.id,
      type: "CALL_MADE",
      createdAt: { gte: new Date(now.getTime() - SAME_CALL_MS) },
      metadata: { path: ["actorId"], equals: userId },
    },
    orderBy: { createdAt: "desc" },
    take: DIAL_CAP,
    select: { id: true, createdAt: true, metadata: true },
  });
  const action = dialAction(
    via,
    recent.map((r) => ({ via: (r.metadata as any)?.via, at: r.createdAt })),
    now,
  );

  if (action === "merge") {
    // The dial happened when they copied, so it moves to now. That also starts
    // the 2-minute redial window from the copy, not the click.
    await prisma.leadActivity.update({
      where: { id: recent[0].id },
      data: { createdAt: now, metadata: { via, actorId: userId } },
    });
  } else if (action === "log") {
    const name = session?.user?.name ?? null;
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        type: "CALL_MADE",
        author: name,
        body: `Dialed by ${name ?? "an agent"}.`,
        metadata: { via, actorId: userId },
      },
    });
  }
  return NextResponse.json({ ok: true, counted: action === "log" });
}
