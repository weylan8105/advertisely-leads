import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { canActOnLead } from "@/lib/leadAccess";
import { canUseTexting } from "@/lib/texting";
import { isSendblueConfigured, sendMessage, toE164 } from "@/lib/sendblue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(leadId: string) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  const canUse = await canUseTexting(userId, isAdmin);

  const lead = await prisma!.lead.findUnique({
    where: { id: leadId },
    select: { id: true, name: true, phone: true, assignedUserId: true, organizationId: true, pipeline: true },
  });
  if (!lead) return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };

  if (!(await canActOnLead(userId, isAdmin, lead))) {
    return { error: NextResponse.json({ error: "You can't message this lead" }, { status: 403 }) };
  }
  return { userId, lead, canUse };
}

/** GET /api/leads/:id/messages — the conversation thread with this lead. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const a = await authorize(params.id);
  if ("error" in a) return a.error;
  // Limited rollout: hide the thread entirely for users without texting access.
  if (!a.canUse) return NextResponse.json({ messages: [], configured: isSendblueConfigured(), canUse: false });

  const messages = await prisma.message.findMany({
    where: { leadId: params.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, direction: true, service: true, content: true, mediaUrls: true,
      status: true, errorMessage: true, createdAt: true,
    },
  });
  return NextResponse.json({ messages, configured: isSendblueConfigured(), canUse: true });
}

/** POST /api/leads/:id/messages — send a text to this lead via Sendblue. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  if (!isSendblueConfigured()) {
    return NextResponse.json({ error: "Texting isn't set up on the server yet." }, { status: 503 });
  }
  const a = await authorize(params.id);
  if ("error" in a) return a.error;
  if (!a.canUse) return NextResponse.json({ error: "Texting isn't enabled for your account yet." }, { status: 403 });
  const { lead } = a;

  const body = (await req.json().catch(() => ({}))) as { content?: string; mediaUrl?: string };
  const content = (body.content ?? "").trim();
  if (!content && !body.mediaUrl) return NextResponse.json({ error: "Message is empty" }, { status: 400 });

  const to = toE164(lead.phone);
  if (!to) return NextResponse.json({ error: "This lead has no valid phone number." }, { status: 400 });

  // Send from the line of whoever owns the lead (keeps a stable number per
  // contact, as Sendblue requires), falling back to the caller's own line.
  const ownerId = lead.assignedUserId ?? a.userId;
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { sendblueNumber: true, sendblueSeatId: true },
  });
  const from = toE164(owner?.sendblueNumber);
  if (!from) {
    return NextResponse.json(
      { error: "No Sendblue line is assigned yet. Add your texting number in Settings → Integrations." },
      { status: 400 },
    );
  }

  const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const token = process.env.SENDBLUE_WEBHOOK_SECRET;
  const statusCallback = base && token ? `${base}/api/sendblue/inbound?token=${encodeURIComponent(token)}` : undefined;

  const result = await sendMessage({
    fromNumber: from,
    toNumber: to,
    content,
    mediaUrl: body.mediaUrl,
    statusCallback,
    seatId: owner?.sendblueSeatId ?? undefined,
  });

  // Persist the outbound message regardless (so the thread reflects attempts),
  // keyed by the Sendblue handle for later status-callback updates.
  const message = await prisma.message.create({
    data: {
      leadId: lead.id,
      userId: ownerId,
      direction: "outbound",
      service: result.service,
      content,
      mediaUrls: body.mediaUrl ? [body.mediaUrl] : [],
      status: result.status ?? (result.ok ? "QUEUED" : "ERROR"),
      errorMessage: result.errorMessage,
      providerId: result.messageHandle,
      fromNumber: from,
      toNumber: to,
    },
    select: {
      id: true, direction: true, service: true, content: true, mediaUrls: true,
      status: true, errorMessage: true, createdAt: true,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.errorMessage ?? "Could not send message", message }, { status: 502 });
  }

  // Log to the lead's activity timeline + mark last contacted.
  await prisma.leadActivity.create({
    data: { leadId: lead.id, type: "NOTE_ADDED", body: `Texted the lead${result.service ? ` (${result.service})` : ""}.` },
  });
  await prisma.lead.update({ where: { id: lead.id }, data: { lastContactedAt: new Date() } });

  return NextResponse.json({ message });
}
