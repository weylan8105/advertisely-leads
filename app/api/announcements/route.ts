import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ANNOUNCEMENTS, findAnnouncement } from "@/data/announcements";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/announcements — one-time announcements the caller hasn't seen. */
export async function GET() {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ pending: [] });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ pending: [] });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { announcementsSeen: true } });
  const seen = new Set(user?.announcementsSeen ?? []);
  let pending = ANNOUNCEMENTS.filter((a) => !seen.has(a.key));

  // Audience targeting: a "working_leads" announcement is shown only to agents who
  // currently have leads to work — an open order (as buyer or recipient) or any
  // assigned leads. Computed only when such an announcement is actually pending.
  if (pending.some((a) => a.audience === "working_leads")) {
    const [openOrders, assignedLeads] = await Promise.all([
      prisma.order.count({
        where: {
          status: { in: ["PENDING", "PROCESSING", "DELIVERING"] },
          OR: [{ userId }, { deliverToUserId: userId }],
        },
      }),
      prisma.lead.count({ where: { assignedUserId: userId, trashedAt: null } }),
    ]);
    const workingLeads = openOrders > 0 || assignedLeads > 0;
    if (!workingLeads) pending = pending.filter((a) => a.audience !== "working_leads");
  }

  return NextResponse.json({ pending });
}

/** POST /api/announcements — mark one announcement as seen for the caller. */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ ok: true });
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { key } = (await req.json().catch(() => ({}))) as { key?: string };
  if (!key || !findAnnouncement(key)) return NextResponse.json({ error: "Unknown announcement" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { announcementsSeen: true } });
  const seen = new Set(user?.announcementsSeen ?? []);
  if (!seen.has(key)) {
    seen.add(key);
    await prisma.user.update({ where: { id: userId }, data: { announcementsSeen: [...seen] } });
  }
  return NextResponse.json({ ok: true });
}
