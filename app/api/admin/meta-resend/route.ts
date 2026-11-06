import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { stageLabel } from "@/data/pipeline";
import { INSTANT_FORM_LEAD_EVENT, STAGE_EVENTS, fireMetaLeadEvent, fireMetaStageEvent } from "@/lib/metaCapi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Meta takes events up to 7 days old. Stop a few minutes short of that.
const WINDOW_MS = 7 * 86_400_000 - 5 * 60_000;
// Answer before the function is cut off; call again for what's left.
const BUDGET_MS = 45_000;
const ABCA_SOURCE = "early-retirement-quiz";
// The stages whose old custom names never reached the Enhanced Wealth pixel.
const RESEND_STAGES = ["approved", "issued-not-paid"];

const moveBody = (stage: string) => `Moved to "${stageLabel(stage)}" in the pipeline.`;

/**
 * POST /api/admin/meta-resend — resend Enhanced Wealth events Meta never showed,
 * at their real times: stage moves and instant form leads still inside Meta's
 * 7-day limit. Skips anything already sent under the current name, so it's safe
 * to repeat until `remaining` is 0. Outcomes land in FunnelEvent like any send.
 * Admin only.
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
        body: { in: RESEND_STAGES.map(moveBody) },
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

  const sent = new Set(
    sends.map((s) => {
      const m = s.cta?.match(/^ok (\S+) .*lead:(\S+)/);
      return m ? `${m[1]}:${m[2]}` : "";
    }),
  );

  // Stage moves first: they're the fewest and the closest to aging out.
  const jobs: (() => Promise<unknown>)[] = [];
  for (const move of moves) {
    const stage = RESEND_STAGES.find((s) => moveBody(s) === move.body)!;
    if (sent.has(`${STAGE_EVENTS[stage].event}:${move.leadId}`)) continue;
    jobs.push(() => fireMetaStageEvent(move.leadId, stage, null, move.createdAt));
  }
  for (const lead of leads) {
    if (sent.has(`${INSTANT_FORM_LEAD_EVENT}:${lead.id}`)) continue;
    jobs.push(() => fireMetaLeadEvent(lead, lead.receivedAt));
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
