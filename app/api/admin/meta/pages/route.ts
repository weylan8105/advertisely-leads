import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const role = (session.user as any).role;
  if (role !== "ADMIN") return null;
  return session;
}

export async function GET() {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pages = await prisma.metaPageConnection.findMany({
    orderBy: { createdAt: "desc" },
    include: { formMappings: true },
  });
  return NextResponse.json({ pages });
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json()) as {
    pageId: string;
    pageName: string;
    pageAccessToken: string;
  };
  if (!body.pageId || !body.pageAccessToken) {
    return NextResponse.json(
      { error: "pageId and pageAccessToken are required" },
      { status: 400 },
    );
  }

  const page = await prisma.metaPageConnection.upsert({
    where: { pageId: body.pageId },
    update: {
      pageName: body.pageName,
      pageAccessToken: body.pageAccessToken,
      enabled: true,
    },
    create: {
      pageId: body.pageId,
      pageName: body.pageName,
      pageAccessToken: body.pageAccessToken,
    },
  });

  return NextResponse.json({ page });
}
