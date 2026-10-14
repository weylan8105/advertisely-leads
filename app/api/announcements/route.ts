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
  const pending = ANNOUNCEMENTS.filter((a) => !seen.has(a.key));
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
