import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { fulfillOrder } from "@/lib/fulfillment";
import { leadPackages } from "@/data/packages";

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
