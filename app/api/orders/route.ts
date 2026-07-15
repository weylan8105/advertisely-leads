import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
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

  const order = await prisma.order.create({
    data: {
      userId: (session.user as any).id,
      packageId: body.packageId,
      quantity: body.quantity,
      pricePerLeadCents: Math.round(pkg.pricePerLead * 100),
      totalCents,
      filterStates: body.filterStates ?? [],
      filterIncomeMin: body.filterIncomeMin,
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
  const orders = await prisma.order.findMany({
    where: { userId: (session.user as any).id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ orders });
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
