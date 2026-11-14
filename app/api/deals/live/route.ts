import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { shortName } from "@/lib/dealAlerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOOKBACK_MS = 10 * 60_000; // a returning tab never replays more than 10 minutes
const MAX_DEALS = 5;

/**
 * GET /api/deals/live?since=<iso> — deals submitted (a lead's first move into
 * Underwriting or later, flagged `submitted` by the stage route) since `since`,
 * for the live deal alerts every signed-in user sees. Agent first name + last
 * initial and the AP only — never the client. Without `since` it just returns
 * the server's clock to start from.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const now = new Date();
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ now: now.toISOString(), deals: [] });

  const raw = req.nextUrl.searchParams.get("since");
  const parsed = raw ? new Date(raw) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return NextResponse.json({ now: now.toISOString(), deals: [] });
  const since = new Date(Math.max(parsed.getTime(), now.getTime() - MAX_LOOKBACK_MS));

  const rows = await prisma.leadActivity.findMany({
    where: {
      type: "STATUS_CHANGED",
      createdAt: { gt: since, lte: now },
      metadata: { path: ["submitted"], equals: true },
      lead: { trashedAt: null },
    },
    orderBy: { createdAt: "desc" },
    take: MAX_DEALS,
    select: { id: true, createdAt: true, metadata: true, author: true },
  });
  const actorIds = [...new Set(rows.map((r) => (r.metadata as any)?.actorId).filter((x): x is string => typeof x === "string"))];
  const users = actorIds.length
    ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, image: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const deals = rows.reverse().map((r) => {
    const md = (r.metadata ?? {}) as Record<string, any>;
    const u = typeof md.actorId === "string" ? byId.get(md.actorId) : undefined;
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      agent: shortName(u?.name ?? r.author),
      image: u?.image ?? null,
      apCents: typeof md.apCents === "number" ? md.apCents : 0,
      stage: typeof md.label === "string" ? md.label : "Underwriting",
      isMe: md.actorId === userId,
    };
  });
  return NextResponse.json({ now: now.toISOString(), deals });
}
