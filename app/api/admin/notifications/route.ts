import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { leadPackages } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/notifications
 *
 * Admin notification feed, derived from real events:
 *   - New lead purchases (orders)
 *   - Pending replacement requests
 *
 * No Notification table needed — we synthesize the feed from the source
 * records and sort by time. The client tracks "seen" via a local timestamp.
 *
 * Requires ADMIN role.
 */
export async function GET(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ notifications: [] });
  }

  const pkgName = (id: string) => leadPackages.find((p) => p.id === id)?.name ?? id;
  const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

  const [orders, replacements] = await Promise.all([
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: { select: { name: true, email: true, agency: true } } },
    }),
    prisma.replacementRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: {
        lead: { select: { name: true } },
        requestedBy: { select: { name: true, email: true } },
      },
    }),
  ]);

  const notifications = [
    ...orders.map((o) => ({
      id: `order_${o.id}`,
      type: "purchase" as const,
      title: "New lead purchase",
      body: `${o.user?.agency || o.user?.name || o.user?.email || "A client"} ordered ${o.quantity}× ${pkgName(o.packageId)} (${money(o.totalCents)})`,
      at: o.createdAt,
      href: "/admin",
    })),
    ...replacements.map((r) => ({
      id: `rep_${r.id}`,
      type: "replacement" as const,
      title: "Replacement request",
      body: `${r.requestedBy?.name || r.requestedBy?.email || "An agent"} requested a replacement for ${r.lead?.name ?? "a lead"}`,
      at: r.createdAt,
      href: "/admin",
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 30);

  return NextResponse.json({ notifications });
}
