import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { serializeLead } from "@/lib/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const localKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * GET /api/dashboard — real aggregates for the signed-in agent's own pipeline:
 * status counts, a 7-day received/contacted series, today's tasks, and the most
 * recent leads. Powers the dashboard (replaces the hardcoded zeros).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const where = { assignedUserId: callerId, trashedAt: null } as const;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 86_400_000 - 1);
  const d7 = new Date(Date.now() - 7 * 86_400_000);
  const chartStart = new Date(startOfToday);
  chartStart.setDate(chartStart.getDate() - 6); // last 7 days incl. today

  const [total, newC, contactedC, apptC, closedC, delivered7d, recvRows, contRows, recent, tasks] =
    await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: "NEW" } }),
      prisma.lead.count({ where: { ...where, status: "CONTACTED" } }),
      prisma.lead.count({ where: { ...where, status: "APPOINTMENT_SET" } }),
      prisma.lead.count({ where: { ...where, status: "CLOSED" } }),
      prisma.lead.count({ where: { ...where, assignedAt: { gte: d7 } } }),
      prisma.lead.findMany({ where: { ...where, assignedAt: { gte: chartStart } }, select: { assignedAt: true } }),
      prisma.lead.findMany({ where: { ...where, lastContactedAt: { gte: chartStart } }, select: { lastContactedAt: true } }),
      prisma.lead.findMany({
        where,
        orderBy: { receivedAt: "desc" },
        take: 6,
        include: {
          assignedUser: { select: { name: true } },
          notes: { orderBy: { createdAt: "desc" } },
          tasks: true,
          activity: { orderBy: { createdAt: "desc" } },
        },
      }),
      prisma.task.findMany({
        where: { assignedTo: callerId, done: false, dueAt: { lte: endOfToday } },
        orderBy: { dueAt: "asc" },
        take: 8,
        include: { lead: { select: { name: true } } },
      }),
    ]);

  // Bucket received / contacted counts into the last 7 local days.
  const recvByDay: Record<string, number> = {};
  const contByDay: Record<string, number> = {};
  for (const r of recvRows) if (r.assignedAt) recvByDay[localKey(r.assignedAt)] = (recvByDay[localKey(r.assignedAt)] ?? 0) + 1;
  for (const r of contRows) if (r.lastContactedAt) contByDay[localKey(r.lastContactedAt)] = (contByDay[localKey(r.lastContactedAt)] ?? 0) + 1;
  const chart = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(startOfToday);
    d.setDate(d.getDate() - i);
    const k = localKey(d);
    chart.push({ day: d.toLocaleDateString("en-US", { weekday: "short" }), received: recvByDay[k] ?? 0, contacted: contByDay[k] ?? 0, set: 0 });
  }

  return NextResponse.json({
    stats: { total, new: newC, contacted: contactedC, presentations: apptC, closed: closedC, delivered7d },
    distribution: [
      { label: "New", count: newC },
      { label: "Contacted", count: contactedC },
      { label: "Presentation Set", count: apptC },
      { label: "Closed", count: closedC },
    ],
    chart,
    recentLeads: recent.map(serializeLead),
    tasks: tasks.map((t) => ({
      id: t.id,
      leadId: t.leadId,
      leadName: t.lead?.name ?? "",
      type: String(t.type).toLowerCase(),
      title: t.title,
      dueAt: t.dueAt.toISOString(),
      done: t.done,
      assignedTo: t.assignedTo,
    })),
  });
}
