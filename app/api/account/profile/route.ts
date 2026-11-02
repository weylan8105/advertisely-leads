import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { AVAILABLE_STATES } from "@/data/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AVAILABLE = new Set(AVAILABLE_STATES);

/** Keep only valid, available 2-letter state codes, uppercased + de-duped. */
function cleanStates(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const v of input) {
    const code = typeof v === "string" ? v.toUpperCase().trim() : "";
    if (AVAILABLE.has(code)) out.add(code);
  }
  return [...out];
}

/** GET /api/account/profile → the caller's editable profile fields. */
export async function GET() {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const user = await prisma.user.findUnique({
    where: { id },
    select: { name: true, email: true, phone: true, agency: true, licensedStates: true, passwordHash: true },
  });
  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    name: user.name ?? "",
    email: user.email,
    phone: user.phone ?? "",
    agency: user.agency ?? "",
    licensedStates: user.licensedStates ?? [],
    hasPassword: !!user.passwordHash, // false for Google-only accounts
  });
}

/** POST /api/account/profile → update name / phone / agency / licensedStates. */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const id = (session?.user as any)?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Record<string, unknown> = {};

  if (typeof body.name === "string") data.name = body.name.trim() || null;
  if (typeof body.agency === "string") data.agency = body.agency.trim() || null;
  if (typeof body.phone === "string") {
    const phone = body.phone.trim();
    if (phone && phone.replace(/\D/g, "").length < 10) {
      return NextResponse.json({ error: "Enter a valid phone number (at least 10 digits)." }, { status: 400 });
    }
    data.phone = phone || null;
  }
  if (body.licensedStates !== undefined) data.licensedStates = cleanStates(body.licensedStates);

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { name: true, email: true, phone: true, agency: true, licensedStates: true, passwordHash: true },
  });

  return NextResponse.json({
    ok: true,
    name: user.name ?? "",
    email: user.email,
    phone: user.phone ?? "",
    agency: user.agency ?? "",
    licensedStates: user.licensedStates ?? [],
    hasPassword: !!user.passwordHash,
  });
}
