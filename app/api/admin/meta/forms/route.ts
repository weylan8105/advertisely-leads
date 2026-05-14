import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  if ((session.user as any).role !== "ADMIN") return null;
  return session;
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
    pageConnectionId: string;
    formId: string;
    formName: string;
    packageId: string;
    fieldMapping?: Record<string, string>;
  };

  if (!body.pageConnectionId || !body.formId || !body.packageId) {
    return NextResponse.json(
      { error: "pageConnectionId, formId, and packageId are required" },
      { status: 400 },
    );
  }

  const mapping = await prisma.metaFormMapping.upsert({
    where: { formId: body.formId },
    update: {
      formName: body.formName,
      packageId: body.packageId,
      fieldMapping: body.fieldMapping ?? {},
      enabled: true,
    },
    create: {
      pageConnectionId: body.pageConnectionId,
      formId: body.formId,
      formName: body.formName,
      packageId: body.packageId,
      fieldMapping: body.fieldMapping ?? {},
    },
  });

  return NextResponse.json({ mapping });
}
