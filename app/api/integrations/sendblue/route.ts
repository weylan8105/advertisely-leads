import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { isSendblueConfigured, toE164 } from "@/lib/sendblue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/sendblue — texting status for the caller. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const isAdmin = (session?.user as any)?.role === "ADMIN";
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ configured: false });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { sendblueNumber: true, sendblueSeatId: true } });

  // The inbound/status webhook URL to register in Sendblue — admins only (carries the secret token).
  let webhookUrl: string | undefined;
  if (isAdmin) {
    const base = (process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
    const token = process.env.SENDBLUE_WEBHOOK_SECRET;
    if (base) webhookUrl = `${base}/api/sendblue/inbound${token ? `?token=${encodeURIComponent(token)}` : ""}`;
  }

  return NextResponse.json({
    configured: isSendblueConfigured(),
    number: user?.sendblueNumber ?? null,
    seatId: user?.sendblueSeatId ?? null,
    isAdmin,
    webhookUrl,
  });
}

/** PUT /api/integrations/sendblue — set the caller's own Sendblue line. */
export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { number?: string | null; seatId?: string | null };
  const number = body.number ? toE164(body.number) : null;
  if (body.number && !number) return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });

  await prisma.user.update({
    where: { id: userId },
    data: { sendblueNumber: number, sendblueSeatId: body.seatId?.trim() || null },
  });
  return NextResponse.json({ number, seatId: body.seatId?.trim() || null });
}
