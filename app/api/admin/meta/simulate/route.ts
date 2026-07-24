import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { ingestLeadFromFields } from "@/lib/leadIngest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  if ((session.user as any).role !== "ADMIN") return null;
  return session;
}

/**
 * Fire a synthetic lead through the exact same ingest + fulfillment path a real
 * Meta lead takes — without a live Meta app. Lets an admin prove that mapping,
 * state normalization, order matching, email, and Sheets delivery all work
 * end-to-end before real campaigns run.
 */
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
    // Either target a real mapped form (uses its packageId + fieldMapping)…
    formId?: string;
    // …or specify a package directly for a quick smoke test.
    packageId?: string;
    name?: string;
    phone?: string;
    state?: string;
    email?: string;
    age?: string | number;
    income?: string | number;
    occupation?: string;
    intentReason?: string;
  };

  let packageId = body.packageId;
  let fieldMapping: Record<string, string> = {};
  let source = "Simulated test lead";

  if (body.formId) {
    const mapping = await prisma.metaFormMapping.findUnique({
      where: { formId: body.formId },
    });
    if (!mapping) {
      return NextResponse.json(
        { error: `No form mapping found for form ${body.formId}` },
        { status: 404 },
      );
    }
    packageId = mapping.packageId;
    fieldMapping = (mapping.fieldMapping as Record<string, string>) ?? {};
    source = `Simulated - ${mapping.formName}`;
  }

  if (!packageId) {
    return NextResponse.json(
      { error: "Provide a formId or a packageId" },
      { status: 400 },
    );
  }

  // Build a flattened field set using Meta's built-in question keys so the
  // shared mapper handles it exactly like a real submission.
  const flat: Record<string, string> = {};
  if (body.name) flat.full_name = String(body.name);
  if (body.phone) flat.phone_number = String(body.phone);
  if (body.email) flat.email = String(body.email);
  if (body.state) flat.state = String(body.state);
  if (body.age != null) flat.age = String(body.age);
  if (body.income != null) flat.income = String(body.income);
  if (body.occupation) flat.occupation = String(body.occupation);
  if (body.intentReason) flat.intent = String(body.intentReason);

  // Any age/income/occupation/intent the caller passed needs a mapping entry so
  // the mapper picks them up as custom fields (built-ins only cover name/phone/
  // email/state). Merge without clobbering a real form's configured mapping.
  fieldMapping = {
    age: "age",
    income: "income",
    occupation: "occupation",
    intent: "intentReason",
    ...fieldMapping,
  };

  // Unique, obviously-synthetic external id so it's idempotent and easy to spot.
  const externalId = `sim-${Date.now()}-${Math.floor(
    Math.random() * 1e6,
  )}`;

  const result = await ingestLeadFromFields({
    externalId,
    flat,
    fieldMapping,
    packageId,
    source,
    activityBody: "Simulated test lead injected from admin panel.",
  });

  if (result.status === "missing_fields") {
    return NextResponse.json(
      {
        error: `Missing required field(s): ${result.missing?.join(", ")}. Name, phone, and state are required.`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    result,
    delivered: result.assigned === true,
    message: result.assigned
      ? "Lead ingested and delivered to a matching order (check the customer's email/Sheet)."
      : "Lead ingested but no open order matched its package/state — it's sitting unassigned in the pool.",
  });
}
