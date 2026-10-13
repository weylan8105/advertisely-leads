import { NextRequest, NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { phoneKey } from "@/lib/sendblue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sendblue posts here for inbound messages (`receive`) and outbound status
// updates. We authenticate with a shared token on the URL (?token=…) since
// Sendblue's signing header isn't documented. Always ack 2xx so Sendblue
// doesn't retry; keep it idempotent via message_handle.
export async function POST(req: NextRequest) {
  const expected = process.env.SENDBLUE_WEBHOOK_SECRET;
  const token = req.nextUrl.searchParams.get("token");
  if (expected && token !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const handle: string | null = body.message_handle ?? null;
  const isOutbound = body.is_outbound === true || body.is_outbound === "true";
  const status: string | null = body.status ?? null;
  const service: string | null = body.service ?? null;
  const errorMessage: string | null = body.error_message ?? null;

  try {
    // ── Outbound status callback → update the message we already stored ──────
    if (isOutbound) {
      if (handle) {
        await prisma.message.updateMany({
          where: { providerId: handle },
          data: { status: status ?? undefined, service: service ?? undefined, errorMessage: errorMessage ?? undefined },
        });
      }
      return NextResponse.json({ ok: true });
    }

    // ── Inbound message from a lead (`receive`) ─────────────────────────────
    // Already stored? (idempotency)
    if (handle) {
      const existing = await prisma.message.findUnique({ where: { providerId: handle }, select: { id: true } });
      if (existing) return NextResponse.json({ ok: true });
    }

    const ourLine = body.sendblue_number ?? body.to_number ?? null; // our Sendblue number
    const leadNumber = body.from_number ?? body.number ?? null; // the lead's number
    const content: string = body.content ?? "";
    const mediaUrl: string | null = body.media_url ?? null;
    const leadKey = phoneKey(leadNumber);
    if (!leadKey) return NextResponse.json({ ok: true });

    // Which agent owns the line it came in on?
    const lineKey = phoneKey(ourLine);
    const agents = lineKey
      ? await prisma.user.findMany({ where: { sendblueNumber: { not: null } }, select: { id: true, sendblueNumber: true } })
      : [];
    const agent = agents.find((u) => phoneKey(u.sendblueNumber) === lineKey) ?? null;

    // Find the matching lead — prefer one assigned to that agent.
    const candidates = await prisma.lead.findMany({
      where: {
        trashedAt: null,
        ...(agent ? { assignedUserId: agent.id } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, phone: true, assignedUserId: true },
      take: 2000,
    });
    const lead = candidates.find((l) => phoneKey(l.phone) === leadKey) ?? null;
    if (!lead) return NextResponse.json({ ok: true }); // nothing to thread onto — ack

    await prisma.message.create({
      data: {
        leadId: lead.id,
        userId: agent?.id ?? lead.assignedUserId ?? null,
        direction: "inbound",
        service,
        content,
        mediaUrls: mediaUrl ? [mediaUrl] : [],
        status: status ?? "DELIVERED",
        providerId: handle,
        fromNumber: leadNumber,
        toNumber: ourLine,
      },
    });
    await prisma.leadActivity.create({
      data: { leadId: lead.id, type: "NOTE_ADDED", body: `Lead replied by text${service ? ` (${service})` : ""}.` },
    });
  } catch (e) {
    console.warn("Sendblue inbound handling failed:", e);
    // Still ack so Sendblue doesn't hammer us with retries.
  }
  return NextResponse.json({ ok: true });
}
