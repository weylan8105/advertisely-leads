import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { deliveredCounts } from "@/lib/orderProgress";
import { fulfillOrder } from "@/lib/fulfillment";
import { findPackage } from "@/data/packages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN = ["PENDING", "PROCESSING", "DELIVERING"] as const;

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  const user = session?.user as any;
  if (!user?.id) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (user.role !== "ADMIN") return { error: NextResponse.json({ error: "Admin access required" }, { status: 403 }) };
  if (!isDatabaseConfigured || !prisma) return { error: NextResponse.json({ error: "Database not configured" }, { status: 503 }) };
  return { user };
}

/**
 * GET /api/admin/orders?userId=<id>
 * A client's lead orders (ones they bought, plus ones routed to them), newest
 * first, with the LIVE delivered count. Admin only.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const orders = await prisma!.order.findMany({
    where: { OR: [{ userId }, { deliverToUserId: userId }] },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, userId: true, deliverToUserId: true, packageId: true, quantity: true, totalCents: true,
      status: true, filterStates: true, createdAt: true, fulfilledAt: true,
    },
  });
  const live = await deliveredCounts(orders.map((o) => o.id));
  const otherIds = [...new Set(orders.flatMap((o) => [o.userId, o.deliverToUserId]).filter((x): x is string => !!x && x !== userId))];
  const others = otherIds.length
    ? await prisma!.user.findMany({ where: { id: { in: otherIds } }, select: { id: true, name: true, email: true } })
    : [];
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const u = others.find((x) => x.id === id);
    return u ? u.name ?? u.email : null;
  };

  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      packageName: findPackage(o.packageId)?.name ?? o.packageId,
      delivered: Math.min(live[o.id] ?? 0, o.quantity),
      open: (OPEN as readonly string[]).includes(o.status),
      boughtBy: o.userId !== userId ? nameOf(o.userId) : null,
      routedTo: o.deliverToUserId && o.deliverToUserId !== userId ? nameOf(o.deliverToUserId) : null,
    })),
  });
}

/**
 * PATCH /api/admin/orders
 * Body: { orderId, action: "quantity" | "close" | "reopen" | "fill", quantity? }
 *  - quantity: change how many leads the order delivers (never below what's
 *    already delivered). Billing is NOT changed — this only adjusts delivery.
 *  - close: stop delivering now (marks the order complete).
 *  - reopen: resume delivering an order that was closed short.
 *  - fill: try to fill it right now from current stock.
 * Admin only. Refunded orders can't be changed.
 */
export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const { orderId, action } = body as { orderId?: string; action?: string };
  if (!orderId || !action) return NextResponse.json({ error: "orderId and action are required" }, { status: 400 });

  const order = await prisma!.order.findUnique({
    where: { id: orderId },
    select: { id: true, quantity: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (order.status === "REFUNDED") return NextResponse.json({ error: "This order was refunded and can't be changed." }, { status: 409 });
  const delivered = (await deliveredCounts([order.id]))[order.id] ?? 0;
  const openStatus = delivered > 0 ? "DELIVERING" : "PROCESSING";

  if (action === "quantity") {
    const q = Math.round(Number(body.quantity));
    if (!Number.isFinite(q) || q < 1) return NextResponse.json({ error: "Enter a quantity of at least 1." }, { status: 400 });
    if (q < delivered) {
      return NextResponse.json({ error: `${delivered} leads are already delivered on this order — the quantity can't go below that.` }, { status: 400 });
    }
    const done = q <= delivered;
    await prisma!.order.update({
      where: { id: order.id },
      data: {
        quantity: q,
        fulfilledCount: delivered,
        status: done ? "DELIVERED" : openStatus,
        fulfilledAt: done ? new Date() : null,
      },
    });
    const added = done ? 0 : await fulfillOrder(order.id);
    return NextResponse.json({
      ok: true,
      message: `Quantity set to ${q}.${added ? ` ${added} more lead${added === 1 ? "" : "s"} delivered right away.` : ""}`,
    });
  }

  if (action === "close") {
    if (order.status === "DELIVERED") return NextResponse.json({ error: "This order is already complete." }, { status: 409 });
    await prisma!.order.update({
      where: { id: order.id },
      data: { status: "DELIVERED", fulfilledCount: delivered, fulfilledAt: new Date() },
    });
    return NextResponse.json({ ok: true, message: `Order closed at ${delivered} of ${order.quantity} delivered — no more leads will go to it.` });
  }

  if (action === "reopen") {
    if (order.status !== "DELIVERED") return NextResponse.json({ error: "This order is already open." }, { status: 409 });
    if (delivered >= order.quantity) {
      return NextResponse.json({ error: "This order is fully delivered. Raise the quantity to send it more leads." }, { status: 409 });
    }
    await prisma!.order.update({
      where: { id: order.id },
      data: { status: openStatus, fulfilledCount: delivered, fulfilledAt: null },
    });
    const added = await fulfillOrder(order.id);
    return NextResponse.json({ ok: true, message: `Order reopened.${added ? ` ${added} lead${added === 1 ? "" : "s"} delivered right away.` : " It will fill as matching leads come in."}` });
  }

  if (action === "fill") {
    if (!(OPEN as readonly string[]).includes(order.status)) {
      return NextResponse.json({ error: "Only an open order can be filled." }, { status: 409 });
    }
    const added = await fulfillOrder(order.id);
    return NextResponse.json({
      ok: true,
      message: added ? `${added} lead${added === 1 ? "" : "s"} delivered.` : "No matching leads in stock right now — it will fill as they come in.",
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
