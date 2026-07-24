import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import {
  fetchMetaFormQuestions,
  META_BUILTIN_KEYS,
} from "@/lib/meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Heuristic auto-suggest: match a question's key/label to a DB field.
function suggestField(key: string, label: string): string | null {
  const t = `${key} ${label}`.toLowerCase();
  if (/\b(income|salary|earn|household)\b/.test(t)) return "income";
  if (/\b(state|province)\b/.test(t)) return "state";
  if (/\b(age)\b/.test(t)) return "age";
  if (/\b(trade|occupation|job|work|profession|career)\b/.test(t)) return "occupation";
  if (/\b(retire|timeline|when|goal|reason|interest)\b/.test(t)) return "intentReason";
  if (/\b(email)\b/.test(t)) return "email";
  if (/\b(phone|mobile|cell)\b/.test(t)) return "phone";
  if (/\b(name)\b/.test(t)) return "name";
  return null;
}

/**
 * GET /api/admin/meta/forms/[formId]/questions
 *
 * Pulls the form's real questions from Meta, tags built-ins (auto-mapped) vs
 * custom questions, echoes the current stored mapping, suggests a mapping for
 * unmapped custom questions, and validates that required DB fields (name /
 * phone / state) are covered. Requires ADMIN role.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { formId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  const mapping = await prisma.metaFormMapping.findUnique({
    where: { formId: params.formId },
    include: { pageConnection: true },
  });
  if (!mapping) {
    return NextResponse.json({ error: "Form mapping not found" }, { status: 404 });
  }
  if (!mapping.pageConnection?.pageAccessToken) {
    return NextResponse.json(
      { error: "The connected Meta page has no access token — reconnect the page first." },
      { status: 422 },
    );
  }

  const current = (mapping.fieldMapping as Record<string, string>) ?? {};

  let form: { name?: string; questions: { key: string; label: string; type?: string }[] };
  try {
    form = await fetchMetaFormQuestions(params.formId, mapping.pageConnection.pageAccessToken);
  } catch (err: any) {
    return NextResponse.json(
      { error: `Couldn't reach Meta for this form: ${err.message}` },
      { status: 502 },
    );
  }

  const questions = form.questions.map((q) => {
    const builtIn = META_BUILTIN_KEYS.has(q.key);
    // Built-in state maps to state; full_name → name; phone_number → phone; email → email.
    const autoField =
      q.key === "full_name" ? "name"
      : q.key === "phone_number" ? "phone"
      : q.key === "email" ? "email"
      : q.key === "state" || q.key === "province" ? "state"
      : null;
    return {
      key: q.key,
      label: q.label,
      type: q.type,
      builtIn,
      autoField, // non-null → mapped automatically, no config needed
      mappedTo: current[q.key] ?? null, // explicit stored mapping (custom questions)
      suggested: builtIn ? null : suggestField(q.key, q.label),
    };
  });

  // Validate coverage of the three required lead fields.
  const coveredFields = new Set<string>();
  for (const q of questions) {
    if (q.autoField) coveredFields.add(q.autoField);
    if (q.mappedTo) coveredFields.add(q.mappedTo);
  }
  const required = ["name", "phone", "state"];
  const missing = required.filter((f) => !coveredFields.has(f));

  return NextResponse.json({
    formId: params.formId,
    formName: mapping.formName || form.name,
    packageId: mapping.packageId,
    questions,
    currentMapping: current,
    validation: { requiredCovered: missing.length === 0, missing },
  });
}
