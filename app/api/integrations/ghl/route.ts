import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Save (or update) a customer's GHL credentials.
 */
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

  const body = (await req.json()) as { apiKey: string; locationId: string };
  if (!body.apiKey || !body.locationId) {
    return NextResponse.json(
      { error: "apiKey and locationId are required" },
      { status: 400 },
    );
  }

  await prisma.integration.upsert({
    where: {
      userId_type: {
        userId: (session.user as any).id,
        type: "GOHIGHLEVEL",
      },
    },
    update: {
      enabled: true,
      config: { apiKey: body.apiKey, locationId: body.locationId },
    },
    create: {
      userId: (session.user as any).id,
      type: "GOHIGHLEVEL",
      config: { apiKey: body.apiKey, locationId: body.locationId },
    },
  });
  return NextResponse.json({ ok: true });
}

export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { connected: false, reason: "Database not configured" },
      { status: 200 },
    );
  }
  const session = await getServerSession(authOptions);
  if (!session?.user || !(session.user as any).id) {
    return NextResponse.json({ connected: false }, { status: 200 });
  }
  const integration = await prisma.integration.findUnique({
    where: {
      userId_type: { userId: (session.user as any).id, type: "GOHIGHLEVEL" },
    },
  });
  return NextResponse.json({
    connected: !!integration?.enabled,
    locationId: (integration?.config as any)?.locationId,
  });
}

export async function DELETE() {
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
  await prisma.integration
    .delete({
      where: {
        userId_type: { userId: (session.user as any).id, type: "GOHIGHLEVEL" },
      },
    })
    .catch(() => null);
  return NextResponse.json({ ok: true });
}
