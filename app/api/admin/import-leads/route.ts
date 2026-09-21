import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { parseCsv, mapCsvToLeads } from "@/lib/leadImport";
import { leadPackages, findPackage } from "@/data/packages";
import { sendLeadDeliveryEmail, isEmailConfigured } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  csv?: string;
  email?: string;
  packageId?: string;
  source?: string;
  campaignName?: string;
  commit?: boolean;
  /** Deliberately allow importing leads outside the order's states (rare override). */
  allowOffState?: boolean;
  /** Deliberately allow importing leads outside the order's age window (rare override). */
  allowAged?: boolean;
}

/**
 * POST /api/admin/import-leads
 *
 * Import a client-ready CSV, assign the leads to a client's order, and mark
 * the order delivered. Idempotent on externalId. Set commit:false for a dry
 * run that returns the mapping + warnings without writing.
 *
 * Requires ADMIN role.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== "ADMIN") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!isDatabaseConfigured || !prisma) {
    return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { csv, email, commit = false } = body;
  if (!csv || !email) {
    return NextResponse.json({ error: "csv and email are required" }, { status: 400 });
  }

  // Resolve the client account.
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
    select: { id: true, name: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: `No account found for "${email}"` }, { status: 404 });
  }

  // Parse + map the CSV.
  const rows = parseCsv(csv);
  const { leads, warnings, unknownStateRows } = mapCsvToLeads(rows);
  if (leads.length === 0) {
    return NextResponse.json({ error: "No lead rows found in the file" }, { status: 400 });
  }

  // Pick the target order: the requested package, else the client's most recent order.
  const order = await prisma.order.findFirst({
    where: { userId: user.id, ...(body.packageId ? { packageId: body.packageId } : {}) },
    orderBy: { createdAt: "desc" },
  });
  if (!order) {
    return NextResponse.json(
      { error: `No matching order found for ${user.email}. The client needs an order before leads can be assigned.` },
      { status: 422 },
    );
  }

  const packageId = order.packageId;
  const source = body.source || "Meta - Import";
  const campaignName = body.campaignName || null;

  // Flag leads whose state falls outside what the order covers.
  const offStates =
    order.filterStates.length > 0
      ? Array.from(new Set(leads.map((l) => l.state).filter((s) => s && !order.filterStates.includes(s))))
      : [];

  // STATE ENFORCEMENT: a client must never receive a lead in a state they did
  // not order. Unless explicitly overridden, only import leads whose state is in
  // the order's states, and refuse an order that has no states configured.
  const allowOffState = body.allowOffState === true;
  if (order.filterStates.length === 0 && !allowOffState) {
    return NextResponse.json(
      { error: "This order has no states configured — refusing to import (it would deliver every state). Set the order's states first, or pass allowOffState:true to override." },
      { status: 422 },
    );
  }
  const inStateLeads =
    order.filterStates.length > 0 && !allowOffState
      ? leads.filter((l) => order.filterStates.includes(l.state))
      : leads;
  const skippedOffState = leads.length - inStateLeads.length;

  // AGE ENFORCEMENT: a Real-Time (fresh) buyer must never be imported an aged
  // lead. Enforce the order's age window (falling back to the package's window,
  // e.g. Real-Time = 0–2 days). Unless overridden, skip out-of-window leads.
  const agePkg = findPackage(order.packageId);
  const ageMaxDays = order.filterAgeMaxDays ?? agePkg?.ageMaxDays ?? null;
  const ageMinDays = order.filterAgeMinDays ?? agePkg?.ageMinDays ?? null;
  const allowAged = body.allowAged === true;
  const ageDaysOf = (l: { receivedAt?: Date | null }) =>
    l.receivedAt ? (Date.now() - new Date(l.receivedAt).getTime()) / 86_400_000 : null;
  const inWindow = (l: { receivedAt?: Date | null }) => {
    if (allowAged) return true;
    const d = ageDaysOf(l);
    if (d == null) return true; // unknown age → don't block
    if (ageMaxDays != null && d > ageMaxDays) return false;
    if (ageMinDays != null && d < ageMinDays) return false;
    return true;
  };
  const deliverable = inStateLeads.filter(inWindow);
  const skippedAged = inStateLeads.length - deliverable.length;

  // Dry run: report without writing.
  if (!commit) {
    return NextResponse.json({
      dryRun: true,
      client: { name: user.name, email: user.email },
      order: { id: order.id, packageId, quantity: order.quantity, filterStates: order.filterStates },
      parsed: leads.length,
      warnings,
      offStateWarning: offStates.length
        ? `${offStates.length} state(s) not in this order: ${offStates.join(", ")}`
        : null,
      willSkipOffState: skippedOffState,
      willSkipAged: skippedAged,
      ageWindow: ageMaxDays != null || ageMinDays != null ? { minDays: ageMinDays, maxDays: ageMaxDays } : null,
      willImport: deliverable.length,
      unknownStates: unknownStateRows.length,
      sample: leads.slice(0, 3).map((l) => ({ name: l.name, state: l.state, email: l.email })),
    });
  }

  // Commit: upsert leads assigned to this user + order — in-state AND in-window only.
  if (deliverable.length === 0) {
    return NextResponse.json(
      {
        error: `No leads match this order's criteria (states ${order.filterStates.join(", ")}${
          ageMaxDays != null ? `, age ≤ ${ageMaxDays}d` : ""
        }). Skipped ${skippedOffState} off-state and ${skippedAged} out-of-age-window lead(s). Nothing imported.`,
      },
      { status: 422 },
    );
  }
  let created = 0, updated = 0;
  for (const m of deliverable) {
    const base = {
      name: m.name, phone: m.phone, email: m.email, state: m.state,
      age: m.age, income: m.income, occupation: m.occupation, intentReason: m.intentReason,
      packageId, source, campaignName,
      consentMethod: "TCPA_WEB_FORM" as const, consentTime: m.consentTime, receivedAt: m.receivedAt,
      rawFormData: m.rawFormData as any, status: "NEW" as const,
      assignedUserId: user.id, assignedAt: new Date(), orderId: order.id,
    };
    if (m.externalId) {
      const existed = await prisma.lead.findUnique({ where: { externalId: m.externalId } });
      await prisma.lead.upsert({
        where: { externalId: m.externalId },
        update: { assignedUserId: user.id, assignedAt: new Date(), orderId: order.id },
        create: { externalId: m.externalId, ...base },
      });
      existed ? updated++ : created++;
    } else {
      await prisma.lead.create({ data: base });
      created++;
    }
  }

  const assignedCount = await prisma.lead.count({ where: { orderId: order.id } });
  const delivered = assignedCount >= order.quantity;
  await prisma.order.update({
    where: { id: order.id },
    data: {
      fulfilledCount: assignedCount,
      status: delivered ? "DELIVERED" : "DELIVERING",
      fulfilledAt: delivered ? new Date() : null,
    },
  });

  const pkgName = leadPackages.find((p) => p.id === packageId)?.name ?? packageId;

  // Automatically notify the client their leads are ready (same email the
  // auto-fulfillment path sends). Never block delivery on an email failure.
  let emailed = false;
  if (isEmailConfigured) {
    try {
      await sendLeadDeliveryEmail({
        agentEmail: user.email,
        agentName: user.name ?? "there",
        leadCount: created + updated,
        packageName: pkgName,
        orderId: order.id,
        leads: deliverable.slice(0, 50).map((l) => ({
          name: l.name,
          phone: l.phone,
          email: l.email,
          state: l.state,
          occupation: l.occupation,
          income: l.income,
          intentReason: l.intentReason,
        })),
      });
      emailed = true;
    } catch (e) {
      console.warn("Delivery email failed:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    emailed,
    client: { name: user.name, email: user.email },
    package: pkgName,
    created, updated,
    skippedOffState,
    skippedAged,
    assignedTotal: assignedCount,
    orderQuantity: order.quantity,
    orderStatus: delivered ? "DELIVERED" : "DELIVERING",
    warnings,
    offStateWarning: skippedOffState
      ? `${skippedOffState} lead(s) skipped — outside the order's states (${offStates.join(", ")}).`
      : null,
    agedWarning: skippedAged
      ? `${skippedAged} lead(s) skipped — outside the order's age window${ageMaxDays != null ? ` (≤ ${ageMaxDays}d)` : ""}.`
      : null,
  });
}
