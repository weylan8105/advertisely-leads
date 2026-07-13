import { NextResponse } from "next/server";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json(
      { error: "Account signups aren't available yet. Please try again later." },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const data = body as Record<string, unknown>;
  const name = typeof data.name === "string" ? data.name.trim() : "";
  const email =
    typeof data.email === "string" ? data.email.toLowerCase().trim() : "";
  const password = typeof data.password === "string" ? data.password : "";
  const agency = typeof data.agency === "string" ? data.agency.trim() : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Try signing in." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      email,
      name: name || null,
      agency: agency || null,
      passwordHash,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
