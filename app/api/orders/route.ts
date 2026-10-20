import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
import { deliveredCounts } from "@/lib/orderProgress";
import { ensureOrgContext } from "@/lib/org";
import { LEADS_PURCHASE_PAUSED, PURCHASE_PAUSED_MESSAGE } from "@/lib/flags";
import { leadPackages } from "@/data/packages";
import {
  isSheetsConfigured,
  sheetsServiceAccountEmail,
  parseSpreadsheetId,
  getFirstCell,
  appendRows,
} from "@/lib/sheets";
import { EXPORT_HEADERS } from "@/lib/leadExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateOrderBody {
  packageId: string;
  quantity: number;
  filterStates?: string[];
  filterIncomeMin?: number;
  // Optional: deliver this order's leads to a downline agent on the buyer's team.
  deliverToUserId?: string | null;
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Kill switch: purchasing is paused. Platform admins may still create orders
  // for internal operations; everyone else is blocked.
  if (LEADS_PURCHASE_PAUSED && (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: PURCHASE_PAUSED_MESSAGE }, { status: 503 });
  }

  let body: CreateOrderBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const pkg = leadPackages.find((p) => p.id === body.packageId);
  if (!pkg) {
    return NextResponse.json({ error: "Unknown package" }, { status: 400 });
  }
  if (!pkg.available) {
    return NextResponse.json(
      { error: `${pkg.name} is coming soon — pricing pending.` },
      { status: 400 },
    );
  }
  if (
    !Number.isInteger(body.quantity) ||
    body.quantity < pkg.minimumOrder
  ) {
    return NextResponse.json(
      { error: `Quantity must be at least ${pkg.minimumOrder}` },
      { status: 400 },
    );
  }

  const totalCents = Math.round(body.quantity * pkg.pricePerLead * 100);

  // Optional: deliver this order to a downline agent. Only valid if the chosen
  // agent is a member of the buyer's team.
  let deliverToUserId: string | null = null;
  if (body.deliverToUserId) {
    const ctx = await ensureOrgContext((session.user as any).id);
    const member = ctx?.organizationId
      ? await prisma.membership.findUnique({
          where: { organizationId_userId: { organizationId: ctx.organizationId, userId: body.deliverToUserId } },
          select: { id: true },
        })
      : null;
    if (!member) {
      return NextResponse.json({ error: "That agent isn't on your team." }, { status: 400 });
    }
    deliverToUserId = body.deliverToUserId;
  }

  const order = await prisma.order.create({
    data: {
      userId: (session.user as any).id,
      packageId: body.packageId,
      quantity: body.quantity,
      pricePerLeadCents: Math.round(pkg.pricePerLead * 100),
      totalCents,
      filterStates: body.filterStates ?? [],
      filterIncomeMin: body.filterIncomeMin,
      deliverToUserId,
      status: "PROCESSING",
    },
  });

  // Immediately try to assign existing pool inventory to this order
  const assigned = await fulfillOrder(order.id);

  return NextResponse.json({
    id: order.id,
    quantity: order.quantity,
    fulfilled: assigned,
    status: assigned >= order.quantity ? "DELIVERED" : "DELIVERING",
  });
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const myId = (session.user as any).id as string;
  // A downline agent sees orders they bought AND orders an upline routed to them.
  const orders = await prisma.order.findMany({
    where: { OR: [{ userId: myId }, { deliverToUserId: myId }] },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  // Report a LIVE delivered count (non-trashed leads actually on each order),
  // capped at the order quantity, so progress can never drift or exceed 100%.
  const live = await deliveredCounts(orders.map((o) => o.id));
  // Resolve the buyer (upline) name for any order routed to me.
  const routedBuyerIds = [...new Set(orders.filter((o) => o.userId !== myId).map((o) => o.userId))];
  const buyers = routedBuyerIds.length
    ? await prisma.user.findMany({ where: { id: { in: routedBuyerIds } }, select: { id: true, name: true, email: true } })
    : [];
  const buyerName: Record<string, string> = {};
  for (const b of buyers) buyerName[b.id] = b.name ?? b.email ?? "upline";

  // Replacement requests on these orders (matched via the bad lead's orderId),
  // so the buyer can see how many they asked for and where each one stands.
  const orderIds = orders.map((o) => o.id);
  const reps = orderIds.length
    ? await prisma.replacementRequest.findMany({
        where: { lead: { orderId: { in: orderIds } } },
        orderBy: { createdAt: "desc" },
        select: {
          status: true,
          autoApproved: true,
          reason: true,
          adminNote: true,
          createdAt: true,
          reviewedAt: true,
          lead: { select: { orderId: true, name: true } },
        },
      })
    : [];
  // Client-facing stage: under_review → approved (finding a replacement) → replaced; or denied.
  const repStage = (r: (typeof reps)[number]) =>
    r.status === "APPROVED" ? "replaced" : r.status === "DENIED" ? "denied" : r.autoApproved ? "finding" : "under_review";
  type RepSummary = {
    total: number; replaced: number; finding: number; underReview: number; denied: number;
    items: { leadName: string; stage: string; reason: string; adminNote: string | null; at: string }[];
  };
  const repByOrder: Record<string, RepSummary> = {};
  for (const r of reps) {
    const oid = r.lead.orderId;
    if (!oid) continue;
    const g = (repByOrder[oid] ??= { total: 0, replaced: 0, finding: 0, underReview: 0, denied: 0, items: [] });
    const stage = repStage(r);
    g.total++;
    if (stage === "replaced") g.replaced++;
    else if (stage === "denied") g.denied++;
    else if (stage === "finding") g.finding++;
    else g.underReview++;
    g.items.push({ leadName: r.lead.name, stage, reason: r.reason, adminNote: r.adminNote, at: r.createdAt.toISOString() });
  }

  const withLive = orders.map((o) => ({
    ...o,
    fulfilledCount: Math.min(live[o.id] ?? 0, o.quantity),
    routedToMe: o.userId !== myId && o.deliverToUserId === myId,
    fromName: o.userId !== myId ? buyerName[o.userId] ?? null : null,
    replacements: repByOrder[o.id] ?? null,
  }));
  // Summary across every order that delivers to me (my own + routed to me), so
  // an agent can see "X of <total> delivered, Y remaining" at a glance.
  const ordered = withLive.reduce((s, o) => s + o.quantity, 0);
  const delivered = withLive.reduce((s, o) => s + o.fulfilledCount, 0);
  return NextResponse.json({
    orders: withLive,
    summary: { ordered, delivered, remaining: Math.max(0, ordered - delivered) },
  });
}

/**
 * PATCH — set or clear a per-order Google Sheet override.
 * Body: { orderId: string, sheetUrl?: string }  (empty/absent sheetUrl clears it)
 */
export async function PATCH(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const userId = (session?.user as any)?.id as string | undefined;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { orderId?: string; sheetUrl?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Only the owner can edit their order.
  const order = await prisma.order.findFirst({
    where: { id: body.orderId, userId },
  });
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Clearing the override — this order falls back to the default sheet.
  if (!body.sheetUrl || !body.sheetUrl.trim()) {
    await prisma.order.update({
      where: { id: order.id },
      data: { sheetOverrideId: null },
    });
    return NextResponse.json({ ok: true, sheetOverrideId: null });
  }

  if (!isSheetsConfigured) {
    return NextResponse.json(
      { error: "Google Sheets isn't enabled on the server yet." },
      { status: 503 },
    );
  }

  const spreadsheetId = parseSpreadsheetId(body.sheetUrl);
  if (!spreadsheetId) {
    return NextResponse.json(
      { error: "That doesn't look like a Google Sheets link." },
      { status: 400 },
    );
  }

  const firstCell = await getFirstCell(spreadsheetId);
  if (!firstCell.ok) {
    return NextResponse.json(
      { error: `Couldn't open that sheet. Share it with ${sheetsServiceAccountEmail} as an Editor, then try again.` },
      { status: 400 },
    );
  }
  if (firstCell.value !== EXPORT_HEADERS[0]) {
    const seed = await appendRows(spreadsheetId, [Array.from(EXPORT_HEADERS)]);
    if (!seed.ok) {
      return NextResponse.json(
        { error: `We can see the sheet but can't write to it. Give ${sheetsServiceAccountEmail} Editor access.` },
        { status: 400 },
      );
    }
  }

  await prisma.order.update({
    where: { id: order.id },
    data: { sheetOverrideId: spreadsheetId },
  });
  return NextResponse.json({ ok: true, sheetOverrideId: spreadsheetId });
}
