import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { CONVERSION_STAGE_IDS, stageLabel } from "@/data/pipeline";
import {
  CONTACTED_EVENT,
  INSTANT_FORM_LEAD_EVENT,
  PICKUP_STAGES,
  QUALIFIED_LEAD_EVENT,
  STAGE_EVENTS,
  UNCREDITED_NOTE,
  fireMetaContactedEvent,
  fireMetaLeadEvent,
  fireMetaQualifiedLeadEvent,
  fireMetaWebsiteQualifiedLeadEvent,
  fireMetaStageEvent,
  isQualifiedLead,
} from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta takes events up to 7 days old. Stop a few minutes short of that.
const WINDOW_MS = 7 * 86_400_000 - 5 * 60_000;
// Answer before the function is cut off; call again for what's left.
const BUDGET_MS = 45_000;
const ABCA_SOURCE = "early-retirement-quiz";
// Every closing stage sends the one Purchase a lead gets; a lead that reached
// one before that was the rule (or under an old custom name) gets it here.
const RESEND_STAGES: string[] = [...CONVERSION_STAGE_IDS];
// Pickup stages: each lead's first one sends its one "Contacted" event.
const PICKUP: string[] = [...PICKUP_STAGES];

const moveBody = (stage: string) => `Moved to "${stageLabel(stage)}" in the pipeline.`;

/**
 * POST /api/admin/meta-resend — resend Enhanced Wealth events Meta never showed,
 * at their real times: closing-stage moves (one Purchase per lead, at its first
 * such move; again if the first went out without Meta's lead id and the id can
 * now be found) and instant form leads still inside Meta's 7-day limit. Skips
 * anything already sent under the current name, so it's safe to repeat until
 * `remaining` is 0. Outcomes land in FunnelEvent like any send. Admin only.
 */
export async function POST() {
  const session = await getServerSession(authOptions);
  if ((session?.user as any)?.role !== "ADMIN") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  if (!isDatabaseConfigured || !prisma) return NextResponse.json({ error: "Database not configured" }, { status: 503 });

  const since = new Date(Date.now() - WINDOW_MS);
  const [sends, moves, leads] = await Promise.all([
    prisma.funnelEvent.findMany({
      where: { source: "meta-capi", createdAt: { gte: since }, cta: { startsWith: "ok " } },
      select: { cta: true },
    }),
    prisma.leadActivity.findMany({
      where: {
        createdAt: { gte: since },
        body: { in: [...new Set([...RESEND_STAGES, ...PICKUP])].map(moveBody) },
        lead: { source: { not: ABCA_SOURCE } },
      },
      select: { leadId: true, body: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.lead.findMany({
      where: { receivedAt: { gte: since }, source: { not: ABCA_SOURCE }, fbclid: null, trashedAt: null },
      orderBy: { receivedAt: "asc" },
    }),
  ]);
  // Website (landing page) leads: only their "Qualified Lead" signal is backfilled here
  // (their Lead event goes out at submit, shared with the browser pixel).
  const websiteLeads = await prisma.lead.findMany({
    where: { receivedAt: { gte: since }, trashedAt: null, OR: [{ fbclid: { not: null } }, { source: ABCA_SOURCE }] },
    orderBy: { receivedAt: "asc" },
  });

  // A Purchase that went out without Meta's lead id doesn't count as sent: it's
  // tried again, and fireMetaStageEvent only resends it once the id is found.
  const PURCHASE = STAGE_EVENTS[RESEND_STAGES[0]]?.event;
  const sent = new Set(
    sends.map((s) => {
      const m = s.cta?.match(/^ok (\S+) .*lead:(\S+)/);
      if (!m) return "";
      if (m[1] === PURCHASE && UNCREDITED_NOTE.test(s.cta ?? "")) return "";
      return `${m[1]}:${m[2]}`;
    }),
  );

  // Stage moves first: they're the fewest and the closest to aging out.
  const jobs: (() => Promise<unknown>)[] = [];
  const queued = new Set<string>();
  for (const move of moves) {
    const pickup = PICKUP.find((s) => moveBody(s) === move.body);
    if (pickup) {
      const ckey = `${CONTACTED_EVENT}:${move.leadId}`;
      if (!sent.has(ckey) && !queued.has(ckey)) {
        queued.add(ckey);
        jobs.push(() => fireMetaContactedEvent(move.leadId, move.createdAt));
      }
    }
    const stage = RESEND_STAGES.find((s) => moveBody(s) === move.body);
    if (!stage) continue;
    const key = `${STAGE_EVENTS[stage].event}:${move.leadId}`;
    if (sent.has(key) || queued.has(key)) continue;
    queued.add(key);
    jobs.push(() => fireMetaStageEvent(move.leadId, stage, null, move.createdAt));
  }
  for (const lead of leads) {
    if (sent.has(`${INSTANT_FORM_LEAD_EVENT}:${lead.id}`)) {
      // Lead already reported: still backfill its "Qualified Lead" signal if missing.
      if (isQualifiedLead(lead.rawFormData) === true && !sent.has(`${QUALIFIED_LEAD_EVENT}:${lead.id}`)) {
        jobs.push(() => fireMetaQualifiedLeadEvent(lead, lead.receivedAt));
      }
      continue;
    }
    // fireMetaLeadEvent sends the "Qualified Lead" signal too when it applies.
    jobs.push(() => fireMetaLeadEvent(lead, lead.receivedAt));
  }

  for (const lead of websiteLeads) {
    const raw = (lead.rawFormData && typeof lead.rawFormData === "object" ? lead.rawFormData : {}) as Record<string, unknown>;
    if (!(lead.fbclid || raw["fbc"] || raw["fbp"])) continue;
    if (isQualifiedLead(lead.rawFormData) === true && !sent.has(`${QUALIFIED_LEAD_EVENT}:${lead.id}`)) {
      jobs.push(() => fireMetaWebsiteQualifiedLeadEvent(lead, lead.receivedAt));
    }
  }

  const started = Date.now();
  let processed = 0;
  for (const job of jobs) {
    if (Date.now() - started > BUDGET_MS) break;
    await job();
    processed++;
  }
  return NextResponse.json({ processed, remaining: jobs.length - processed });
}
