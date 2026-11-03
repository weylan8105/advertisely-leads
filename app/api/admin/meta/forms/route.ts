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
    // Optional advertiser email. When provided, this form becomes EXCLUSIVE —
    // every lead it produces is delivered straight to that user's CRM and never
    // enters marketplace distribution. Empty/omitted clears it (back to shared).
    ownerEmail?: string | null;
  };

  if (!body.pageConnectionId || !body.formId || !body.packageId) {
    return NextResponse.json(
      { error: "pageConnectionId, formId, and packageId are required" },
      { status: 400 },
    );
  }

  // Resolve the advertiser email → userId (validated here so a typo can't
  // silently drop the exclusivity). An empty string explicitly clears the owner.
  let ownerUserId: string | null = null;
  let ownerUser: { id: string; name: string | null; email: string } | null = null;
  const ownerEmail = body.ownerEmail?.trim().toLowerCase();
  if (ownerEmail) {
    ownerUser = await prisma.user.findUnique({
      where: { email: ownerEmail },
      select: { id: true, name: true, email: true },
    });
    if (!ownerUser) {
      return NextResponse.json(
        { error: `No Advertisely user found with email "${ownerEmail}". Create their account first.` },
        { status: 400 },
      );
    }
    ownerUserId = ownerUser.id;
  }

  const mapping = await prisma.metaFormMapping.upsert({
    where: { formId: body.formId },
    update: {
      formName: body.formName,
      packageId: body.packageId,
      fieldMapping: body.fieldMapping ?? {},
      ownerUserId,
      enabled: true,
    },
    create: {
      pageConnectionId: body.pageConnectionId,
      formId: body.formId,
      formName: body.formName,
      packageId: body.packageId,
      fieldMapping: body.fieldMapping ?? {},
      ownerUserId,
    },
  });

  // Hand the UI the owner's display info so the "Exclusive" badge renders at once.
  return NextResponse.json({
    mapping: {
      ...mapping,
      ownerEmail: ownerUser?.email ?? null,
      ownerName: ownerUser?.name ?? null,
    },
  });
}
