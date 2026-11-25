import { isQualifiedLead } from "@/lib/metaCapi";
import { stageLevel, moveLevel } from "@/lib/activityStats";
import { WON_STAGE_ID } from "@/data/pipeline";

// ─── Open vs filtered split test (owner, Nov 24 2026) ────────────────────────
// Each account runs two mirrored campaigns with the same one-angle ad sets and
// ads: OPEN (no knockouts: the 11/11 instant form / the /open page) and
// FILTERED (the knockout form / page at /). Meta's A/B study splits the audience
// between them, but Meta can only pick a winner on cost per lead. This scorecard
// judges them on quality instead: qualified, contacted, appointments,
// applications and sales, with the cost of each.
//
// Leads are matched to an arm by the Meta campaign id they carry
// (rawFormData.utm_campaign on quiz leads, a campaignId field on instant-form
// leads), so nothing else in the account can leak in.

export interface SplitArm {
  key: "open" | "filtered";
  label: string;
  campaignIds: string[];
}

export interface SplitTest {
  key: string;
  label: string;
  account: "ABCA" | "Enhanced Wealth";
  /** First day (America/Chicago) counted. The campaigns launched the night of Nov 24. */
  since: string;
  /** Last day of Meta's A/B study. */
  studyEnds: string;
  arms: [SplitArm, SplitArm];
}

export const SPLIT_TESTS: SplitTest[] = [
  {
    key: "ew",
    label: "Enhanced Wealth: instant form",
    account: "Enhanced Wealth",
    since: "2026-11-24",
    studyEnds: "2026-12-09",
    arms: [
      { key: "open", label: "Open (11/11 form, no knockouts)", campaignIds: ["120251958292870396"] },
      { key: "filtered", label: "Filtered (v6 knockout form)", campaignIds: ["120251958553830396"] },
    ],
  },
  {
    key: "abca",
    label: "ABCA: landing page",
    account: "ABCA",
    since: "2026-11-24",
    studyEnds: "2026-12-09",
    arms: [
      { key: "open", label: "Open (/open page, no knockouts)", campaignIds: ["120251118033170207"] },
      { key: "filtered", label: "Filtered (knockout page /)", campaignIds: ["120251118295040207"] },
    ],
  },
];

/** Every campaign id in the tests, for the lead query. */
export const SPLIT_TEST_CAMPAIGN_IDS = SPLIT_TESTS.flatMap((t) => t.arms.flatMap((a) => a.campaignIds));

// Stages that count as a submitted application, as on the creative scorecard.
export const APP_STAGES = ["underwriting", "approved", "issued-not-paid", "issued-paid"];
const APP_LABEL_RE = /^Moved to "(Underwriting|Approved|Issued Not Paid|Issued PAID.*)" in the pipeline\.$/;

export interface SplitLead {
  id: string;
  campaignId: string;
  rawFormData: unknown;
  pipelineStage: string | null;
  soldAt: Date | null;
  soldPremiumCents: number | null;
  trashed: boolean;
}

export interface SplitMove {
  leadId: string;
  body: string;
  metadata: unknown;
}

export interface ArmStats {
  key: SplitArm["key"];
  label: string;
  spendCents: number;
  leads: number;
  /** Leads we could score as qualified or not (both age and income/work answered). */
  scored: number;
  qualified: number;
  trashed: number;
  dialed: number;
  contacted: number;
  appointments: number;
  presentations: number;
  apps: number;
  sold: number;
  premiumCents: number;
}

/** Highest funnel step a lead reached: 0 new, 1 dialed, 2 contacted, 3 appointment, 4 presentation+. */
export function leadLevel(lead: Pick<SplitLead, "pipelineStage">, moves: SplitMove[]): number {
  let level = stageLevel(lead.pipelineStage, null);
  for (const m of moves) level = Math.max(level, moveLevel(m.body, m.metadata));
  return level;
}

/** The lead reached an application stage at some point (it still counts if declined later). */
export function reachedApp(lead: Pick<SplitLead, "pipelineStage">, moves: SplitMove[]): boolean {
  if (lead.pipelineStage && APP_STAGES.includes(lead.pipelineStage)) return true;
  return moves.some((m) => {
    const md = (m.metadata && typeof m.metadata === "object" ? m.metadata : {}) as Record<string, unknown>;
    return (typeof md.stage === "string" && APP_STAGES.includes(md.stage)) || APP_LABEL_RE.test(m.body);
  });
}

/** Roll leads (and their stage moves) up into one row per arm of a test. */
export function scoreSplitTest(
  test: SplitTest,
  leads: SplitLead[],
  moves: SplitMove[],
  spendByCampaign: Map<string, number>,
): ArmStats[] {
  const movesByLead = new Map<string, SplitMove[]>();
  for (const m of moves) {
    const list = movesByLead.get(m.leadId);
    if (list) list.push(m);
    else movesByLead.set(m.leadId, [m]);
  }
  return test.arms.map((arm) => {
    const ids = new Set(arm.campaignIds);
    const s: ArmStats = {
      key: arm.key,
      label: arm.label,
      spendCents: arm.campaignIds.reduce((t, id) => t + (spendByCampaign.get(id) ?? 0), 0),
      leads: 0, scored: 0, qualified: 0, trashed: 0,
      dialed: 0, contacted: 0, appointments: 0, presentations: 0, apps: 0, sold: 0, premiumCents: 0,
    };
    for (const lead of leads) {
      if (!ids.has(lead.campaignId)) continue;
      const lm = movesByLead.get(lead.id) ?? [];
      s.leads++;
      if (lead.trashed) s.trashed++;
      const q = isQualifiedLead(lead.rawFormData);
      if (q !== null) s.scored++;
      if (q === true) s.qualified++;
      const level = leadLevel(lead, lm);
      if (level >= 1) s.dialed++;
      if (level >= 2) s.contacted++;
      if (level >= 3) s.appointments++;
      if (level >= 4) s.presentations++;
      if (reachedApp(lead, lm)) s.apps++;
      if (lead.soldAt || lead.pipelineStage === WON_STAGE_ID) {
        s.sold++;
        s.premiumCents += lead.soldPremiumCents ?? 0;
      }
    }
    return s;
  });
}
