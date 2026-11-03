import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ensureOrgContext, canManageTeam } from "@/lib/org";
import { AVAILABLE_STATES } from "@/data/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATES = new Set(AVAILABLE_STATES.map((s) => String(s).toUpperCase()));
const OPEN_STATUSES = ["PENDING", "PROCESSING", "DELIVERING"];

/**
 * PATCH /api/orders/:id/states   Body: { states: string[] }
 *
 * Update the states a still-open order pulls leads from. Future deliveries use
 * the new set; already-delivered leads are unaffected. Only the order's buyer,
 * an org manager, or a platform admin may edit. States must be valid and ones
 * the recipient is licensed in (when they've set a licensing list), and at least
 * one is required. A completed order can't be changed (place a new order).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }
  const session = await getServerSession(authOptions);
  const callerId = (session?.user as any)?.id as string | undefined;
  const isPlatformAdmin = (session?.user as any)?.role === "ADMIN";
  if (!callerId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { states?: unknown };
  if (!Array.isArray(body.states)) {
    return NextResponse.json({ error: "A `states` array is required." }, { status: 400 });
  }
  const states = [
    ...new Set(body.states.map((s) => String(s).toUpperCase().trim()).filter(Boolean)),
  ];
  if (states.length === 0) {
    return NextResponse.json({ error: "Select at least one state for this order." }, { status: 400 });
  }
  const invalid = states.filter((s) => !VALID_STATES.has(s));
  if (invalid.length) {
    return NextResponse.json({ error: `Not valid states: ${invalid.join(", ")}.` }, { status: 400 });
  }

  const order = await prisma.order.findUnique({
    where: { id: params.id },
    select: { id: true, userId: true, deliverToUserId: true, organizationId: true, status: true },
  });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Authorization: buyer, org manager of the order's org, or platform admin.
  const ctx = await ensureOrgContext(callerId);
  const isBuyer = order.userId === callerId;
  const managesOrg =
    !!ctx && canManageTeam(ctx.role) && !!order.organizationId && order.organizationId === ctx.organizationId;
  if (!isBuyer && !managesOrg && !isPlatformAdmin) {
    return NextResponse.json({ error: "You can't edit this order." }, { status: 403 });
  }

  // Only still-open orders can have their states changed.
  if (!OPEN_STATUSES.includes(order.status)) {
    return NextResponse.json(
      { error: "This order is already complete — its states can't be changed. Place a new order for different states." },
      { status: 400 },
    );
  }

  // Licensing: the recipient (the agent who gets the leads) must be licensed in
  // every selected state, when they've set a licensing list. Platform admins are
  // exempt (they may be fixing data).
  const recipientId = order.deliverToUserId ?? order.userId;
  const recipient = await prisma.user.findUnique({
    where: { id: recipientId },
    select: { licensedStates: true },
  });
  const licensed = recipient?.licensedStates ?? [];
  if (!isPlatformAdmin && licensed.length > 0) {
    const unlicensed = states.filter((s) => !licensed.includes(s));
    if (unlicensed.length) {
      const who = order.deliverToUserId && order.deliverToUserId !== callerId ? "The agent isn't" : "You're not";
      return NextResponse.json(
        { error: `${who} licensed in: ${unlicensed.join(", ")}. Add them to your licensed states first (Settings → Profile).` },
        { status: 400 },
      );
    }
  }

  await prisma.order.update({ where: { id: order.id }, data: { filterStates: states } });
  return NextResponse.json({ ok: true, states });
}
