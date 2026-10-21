"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  Loader2, TrendingDown, Eye, CheckCircle2, RefreshCw, Megaphone, Calendar, ChevronDown, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Step { step: number; label: string; count: number; stepConversion: number; dropPct: number; lost: number }
interface SeriesPoint { date: string; views: number; completes: number; adViews: number; anViews?: number }
interface FunnelData {
  range: string; from: string; to: string;
  views: number; completes: number; completionRate: number;
  adViews: number; adCompletes: number; adCompletionRate: number; adSharePct: number;
  nonAdViews: number; nonAdCompletes: number; nonAdCompletionRate: number;
  steps: Step[];
  biggestDrop: { step: number; label: string; dropPct: number; lost: number } | null;
  series: SeriesPoint[];
  adFunnelConfigured?: boolean;
  adLinkClicks?: number;
  adLandingViews?: number;
  trueAdConversionRate?: number | null;
  adFunnelError?: string | null;
  anVisitors?: number;
  anStarted?: number;
  anCompletes?: number;
  duplicateLoads?: number;
  viewSessions?: number;
  adCompletesAll?: number;
  entryPoints?: { cta: string; count: number }[];
  zipErrors?: { empty: number; partial: number };
  variant?: "A" | "B" | null;
  stepMode?: "questions" | "milestones";
  abTest?: ABTest | null;
}

interface ArmStats {
  visitors: number; started: number; zipEntered: number; reachedContact: number; leads: number;
  startRate: number; zipRate: number; contactRate: number; leadRate: number;
}
interface ABTest {
  A: ArmStats; B: ArmStats;
  startP: number | null; contactP: number | null; leadP: number | null;
  startLiftPct: number | null; contactLiftPct: number | null; leadLiftPct: number | null;
  leadCI: [number, number] | null;
  plannedStart: number; plannedLeads: number;
  window: { start: string; end: string };
}

// Plain-English read of one A/B metric. Only calls a winner once both versions reach
// the planned sample — a "significant" result on day 3 is usually noise from peeking.
// A non-significant result at the planned sample is "inconclusive", never "no difference":
// this test can only reliably detect about a 30% change in leads per visitor.
function abVerdict(p: number | null, lift: number | null, nA: number, nB: number, planned: number) {
  if (p === null || lift === null || Math.min(nA, nB) < 30) return { text: "Not enough data yet", tone: "muted" as const };
  const l = `${lift > 0 ? "+" : ""}${lift}%`;
  const reached = Math.min(nA, nB) >= planned;
  if (p < 0.05) {
    const who = lift > 0 ? "B is ahead" : "A is ahead";
    return reached
      ? { text: `${who} (${l} for B, significant)`, tone: lift > 0 ? ("good" as const) : ("bad" as const) }
      : { text: `${who} (${l} for B) — early signal, keep running`, tone: "muted" as const };
  }
  return reached
    ? { text: `Inconclusive (${l} for B) — a real gap smaller than ~30% can't be ruled out`, tone: "muted" as const }
    : { text: `Too close to call (${l} for B) — keep running`, tone: "muted" as const };
}

function ABTestCard({ ab }: { ab: ABTest }) {
  const n = Math.min(ab.A.visitors, ab.B.visitors);
  // Guardrail agreed up front: stop B if it's clearly producing fewer leads after ~1,000 each.
  const stopB = n >= 1000 && ab.leadP !== null && ab.leadP < 0.05 && (ab.leadLiftPct ?? 0) < 0;
  const lead = stopB
    ? { text: `B is losing leads (${ab.leadLiftPct}% for B) — guardrail hit, stop version B`, tone: "bad" as const }
    : abVerdict(ab.leadP, ab.leadLiftPct, ab.A.visitors, ab.B.visitors, ab.plannedLeads);
  // Reaching the contact form is the fair early read (both versions have answered the same
  // questions by then). "Started" isn't comparable (a tap vs typing a ZIP), so it stays neutral.
  const contact = abVerdict(ab.contactP, ab.contactLiftPct, ab.A.visitors, ab.B.visitors, ab.plannedStart);
  const start = { ...abVerdict(ab.startP, ab.startLiftPct, ab.A.visitors, ab.B.visitors, ab.plannedStart), tone: "muted" as const };
  const tone = (t: "good" | "bad" | "muted") => (t === "good" ? "text-emerald-700" : t === "bad" ? "text-rose-600" : "text-foreground");
  const row = (name: string, a: ArmStats) => (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-2 font-medium">{name}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{a.visitors.toLocaleString()}</td>
      <td className="py-1.5 px-2 text-right tabular-nums">{a.started.toLocaleString()} <span className="text-muted-foreground">({a.startRate}%)</span></td>
      <td className="py-1.5 px-2 text-right tabular-nums">{a.zipEntered.toLocaleString()} <span className="text-muted-foreground">({a.zipRate}%)</span></td>
      <td className="py-1.5 px-2 text-right tabular-nums">{a.reachedContact.toLocaleString()} <span className="text-muted-foreground">({a.contactRate}%)</span></td>
      <td className="py-1.5 px-2 text-right tabular-nums">{a.leads.toLocaleString()}</td>
      <td className="py-1.5 pl-2 text-right tabular-nums font-semibold">{a.leadRate}%</td>
    </tr>
  );
  return (
    <div className="mb-5 rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <div className="text-sm font-semibold">A/B test: tap-first hero (B) vs ZIP-first (A)</div>
        <div className="text-[11px] text-muted-foreground">
          Whole test since {new Date(ab.window.start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ad visitors only · winner = leads per visitor
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] text-muted-foreground">
              <th className="text-left font-medium pb-1 pr-2">Version</th>
              <th className="text-right font-medium pb-1 px-2">Visitors</th>
              <th className="text-right font-medium pb-1 px-2">Started</th>
              <th className="text-right font-medium pb-1 px-2">Entered ZIP</th>
              <th className="text-right font-medium pb-1 px-2">Contact form</th>
              <th className="text-right font-medium pb-1 px-2">Leads</th>
              <th className="text-right font-medium pb-1 pl-2">Leads / visitor</th>
            </tr>
          </thead>
          <tbody>
            {row("A — ZIP first", ab.A)}
            {row("B — tap first", ab.B)}
          </tbody>
        </table>
      </div>
      <div className="mt-2 space-y-0.5 text-[11px]">
        <div>
          <span className="text-muted-foreground">Leads per visitor (decides the winner): </span>
          <span className={cn("font-medium", tone(lead.tone))}>{lead.text}</span>
          {ab.leadP !== null && <span className="text-muted-foreground"> · p = {ab.leadP}</span>}
          {ab.leadCI && (
            <span className="text-muted-foreground">
              {" "}· likely range for B: {ab.leadCI[0] > 0 ? "+" : ""}{ab.leadCI[0]}% to {ab.leadCI[1] > 0 ? "+" : ""}{ab.leadCI[1]}%
            </span>
          )}
        </div>
        <div><span className="text-muted-foreground">Reached the contact form (fair early read): </span><span className={cn("font-medium", tone(contact.tone))}>{contact.text}</span>{ab.contactP !== null && <span className="text-muted-foreground"> · p = {ab.contactP}</span>}</div>
        <div><span className="text-muted-foreground">Started the quiz (info only — a tap is easier than typing a ZIP): </span><span className={cn("font-medium", tone(start.tone))}>{start.text}</span></div>
        {stopB && <div className="font-semibold text-rose-600">Stop version B: after 1,000+ visitors each it&apos;s producing clearly fewer leads per visitor. Set AB_SPLIT_B = 0 in abca-quiz.html.</div>}
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
          <span>Sample per version: {n.toLocaleString()} / {ab.plannedLeads.toLocaleString()} for the leads decision</span>
          <span>first-answer read at {ab.plannedStart.toLocaleString()}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full bg-brand-red/70" style={{ width: `${Math.min(100, Math.round((n / ab.plannedLeads) * 100))}%` }} />
        </div>
      </div>
    </div>
  );
}

// Human-readable names for the quiz entry points the landing page reports.
const CTA_LABELS: Record<string, string> = {
  hero_zip_auto: "Hero ZIP (auto)",
  hero_zip_submit: "Hero ZIP (button)",
  final_zip_auto: "Bottom ZIP (auto)",
  final_zip_submit: "Bottom ZIP (button)",
  header: "Header button",
  sticky: "Sticky button",
  untracked: "Before tracking",
};

type Selection = { kind: "preset"; key: string } | { kind: "custom"; from: string; to: string };

const PRESETS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "14d", label: "Last 14 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "max", label: "Maximum" },
];

const todayYmd = () => new Date().toISOString().slice(0, 10);
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function selectionLabel(sel: Selection): string {
  if (sel.kind === "custom") return "Custom range";
  return PRESETS.find((p) => p.key === sel.key)?.label ?? "Last 7 days";
}

/** Facebook-style date-range control: presets + a custom from/to range. */
function DateRangePicker({ value, onChange }: { value: Selection; onChange: (s: Selection) => void }) {
  const [open, setOpen] = useState(false);
  const [cFrom, setCFrom] = useState(value.kind === "custom" ? value.from : "");
  const [cTo, setCTo] = useState(value.kind === "custom" ? value.to : todayYmd());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm hover:bg-slate-50"
      >
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{selectionLabel(value)}</span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="grid grid-cols-2 gap-1">
            {PRESETS.map((p) => {
              const active = value.kind === "preset" && value.key === p.key;
              return (
                <button
                  key={p.key}
                  onClick={() => { onChange({ kind: "preset", key: p.key }); setOpen(false); }}
                  className={cn(
                    "rounded-md px-2.5 py-1.5 text-left text-sm transition-colors",
                    active ? "bg-brand-red text-white" : "hover:bg-slate-100 text-foreground",
                  )}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="mt-2 border-t border-slate-100 pt-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-1 mb-1">
              Custom range
            </div>
            <div className="flex items-center gap-1.5 px-1">
              <input type="date" value={cFrom} max={cTo || todayYmd()} onChange={(e) => setCFrom(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-200 px-2 text-xs" />
              <span className="text-xs text-muted-foreground">–</span>
              <input type="date" value={cTo} max={todayYmd()} onChange={(e) => setCTo(e.target.value)}
                className="w-full h-8 rounded-md border border-slate-200 px-2 text-xs" />
            </div>
            <Button
              size="sm"
              className="mt-2 w-full"
              disabled={!cFrom || !cTo || cFrom > cTo}
              onClick={() => { onChange({ kind: "custom", from: cFrom, to: cTo }); setOpen(false); }}
            >
              Apply range
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-3", accent ? "border-brand-red/30 bg-brand-red/[0.03]" : "border-slate-200 bg-white")}>
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export function FunnelAnalytics() {
  const [sel, setSel] = useState<Selection>({ kind: "preset", key: "7d" });
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  // A/B test: which version's funnel to show ("all" = both, step bars become milestones).
  const [variant, setVariant] = useState<"all" | "A" | "B">("all");

  // Only the latest request may update the view (fast range/version switching can
  // otherwise land an older response under the newer selection's label).
  const reqId = useRef(0);
  const load = useCallback(() => {
    const id = ++reqId.current;
    setLoading(true);
    const qs = (sel.kind === "custom" ? `from=${sel.from}&to=${sel.to}` : `range=${sel.key}`) +
      (variant !== "all" ? `&variant=${variant}` : "");
    fetch(`/api/admin/funnel?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (id === reqId.current) setData(d); })
      .catch(() => { if (id === reqId.current) setData(null); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [sel, variant]);

  useEffect(() => { load(); }, [load]);

  const top = data?.steps[0]?.count || data?.views || 0;
  const series = data?.series ?? [];
  const maxViews = Math.max(1, ...series.map((s) => s.views));
  const labelEvery = Math.max(1, Math.ceil(series.length / 12));
  // The last covered day (API `to` is exclusive) for the "Showing …" caption.
  const endDisplay = data ? new Date(Math.min(Date.now(), new Date(data.to).getTime() - 1)).toISOString() : null;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
        <DateRangePicker value={sel} onChange={setSel} />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>
      {data && endDisplay && (
        <p className="mb-4 text-[11px] text-muted-foreground">
          Showing <span className="font-medium text-foreground">{fmtDay(data.from)} – {fmtDay(endDisplay)}</span>
          {variant !== "all" && <> · <span className="font-medium text-foreground">Version {variant} only</span></>}
        </p>
      )}

      {/* A/B test: comparison + which version's funnel to show */}
      {(data?.abTest || variant !== "all") && (
        <div className="mb-3 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Funnel for:</span>
          {(["all", "A", "B"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVariant(v)}
              className={cn(
                "rounded-md border px-2.5 py-1",
                variant === v ? "border-brand-red bg-brand-red/10 text-brand-red font-medium" : "border-slate-200 text-muted-foreground hover:bg-slate-50",
              )}
            >
              {v === "all" ? "Both versions" : v === "A" ? "A — ZIP first" : "B — tap first"}
            </button>
          ))}
        </div>
      )}
      {!loading && data?.abTest && <ABTestCard ab={data.abTest} />}

      {loading ? (
        <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading funnel…
        </div>
      ) : !data ? (
        <div className="text-rose-600 text-sm py-8 text-center">Couldn&apos;t load funnel analytics.</div>
      ) : data.views === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">
          No visits recorded in this range. Try a wider date range, or data will appear as people land on the funnel.
        </div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat icon={<Eye className="h-3.5 w-3.5" />} label="Visitors" value={data.views.toLocaleString()}
              sub={`${data.adViews.toLocaleString()} from ads · ${data.nonAdViews.toLocaleString()} direct`} />
            <Stat accent icon={<Megaphone className="h-3.5 w-3.5 text-brand-red" />} label="From ads (FB)"
              value={data.adViews.toLocaleString()}
              sub={`${data.adSharePct}% of traffic · ${data.adCompletes} done (${data.adCompletionRate}%)`} />
            <Stat icon={<CheckCircle2 className="h-3.5 w-3.5" />} label="Completed"
              value={data.completes.toLocaleString()} sub={`${data.adCompletes} from ads`} />
            <Stat icon={<TrendingDown className="h-3.5 w-3.5" />} label="Completion rate"
              value={`${data.completionRate}%`} sub={`ads ${data.adCompletionRate}% · direct ${data.nonAdCompletionRate}%`} />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">Visitors</span> = unique people (repeat page loads merged).{" "}
            <span className="font-medium text-foreground">From ads</span> = arrived with a Facebook click ID. Direct includes
            testing.
          </p>

          {/* What the headline excludes, so a junk-click burst can't masquerade as a page problem. */}
          {variant === "all" && ((data.anVisitors ?? 0) > 0 || (data.duplicateLoads ?? 0) > 0) && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-900">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
              <span>
                <span className="font-semibold">Not counted above:</span>{" "}
                {(data.anVisitors ?? 0) > 0 && (
                  <>
                    {(data.anVisitors ?? 0).toLocaleString()} Audience Network visits (accidental in-app ad taps) —{" "}
                    {data.anStarted ?? 0} started, {data.anCompletes ?? 0} became leads
                    {(data.duplicateLoads ?? 0) > 0 ? "; " : "."}
                  </>
                )}
                {(data.duplicateLoads ?? 0) > 0 && (
                  <>{(data.duplicateLoads ?? 0).toLocaleString()} repeat page loads by the same visitor.</>
                )}
              </span>
            </div>
          )}

          {/* How people entered the quiz + ZIP-button dead ends (measures the ZIP-form changes). */}
          {((data.entryPoints?.length ?? 0) > 0 || (data.zipErrors?.empty ?? 0) + (data.zipErrors?.partial ?? 0) > 0) && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">Started the quiz from:</span>{" "}
              {(data.entryPoints ?? []).map((e) => `${CTA_LABELS[e.cta] ?? e.cta} ${e.count.toLocaleString()}`).join(" · ")}
              {(data.zipErrors?.empty ?? 0) + (data.zipErrors?.partial ?? 0) > 0 && (
                <>
                  {" "}· <span className="font-medium text-foreground">ZIP button tapped without a full ZIP:</span>{" "}
                  {data.zipErrors?.empty ?? 0} empty, {data.zipErrors?.partial ?? 0} partial
                </>
              )}
            </p>
          )}

          {/* True ad conversion vs Facebook's own click count (ABCA funnel account). */}
          {data.adFunnelConfigured && data.trueAdConversionRate != null ? (
            <div className="mt-2 mb-6 flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-muted-foreground">
              <Megaphone className="h-3.5 w-3.5 mt-0.5 shrink-0 text-brand-red" />
              <span>
                <span className="font-semibold text-foreground">True ad conversion: {data.trueAdConversionRate}%</span>{" "}
                — {(data.adCompletesAll ?? data.adCompletes).toLocaleString()} ad leads ÷{" "}
                {(data.adLandingViews || data.adLinkClicks || 0).toLocaleString()} Facebook{" "}
                {data.adLandingViews ? "landing-page views" : "link clicks"} (Meta-reported). This is lower than the
                5%-style rate above because Facebook counts clicks that never load the page.
              </span>
            </div>
          ) : (
            <p className="mt-2 mb-6 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">True ad conversion</span> (leads ÷ real Facebook clicks) is off
              until the ABCA funnel ad account is connected — set <code className="rounded bg-slate-100 px-1">ABCA_AD_ACCOUNT_ID</code>.
              {data.adFunnelError ? ` (${data.adFunnelError})` : ""}
            </p>
          )}

          {/* Daily trend */}
          {series.length > 0 && (
            <div className="mb-6">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center justify-between">
                <span>Daily trend</span>
                <span className="inline-flex items-center gap-3 normal-case tracking-normal">
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-brand-red/50" /> Visitors</span>
                  <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Completed</span>
                </span>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-end gap-[2px] h-32">
                  {series.map((s) => (
                    <div
                      key={s.date}
                      className="flex-1 min-w-0 h-full flex items-end justify-center relative group"
                      title={`${s.date}: ${s.views} visitors · ${s.completes} completed · ${s.adViews} from ads${s.anViews ? ` · ${s.anViews} Audience Network (excluded)` : ""}`}
                    >
                      <div className="relative w-full max-w-[16px] h-full flex items-end justify-center">
                        <div className="w-full rounded-t bg-gradient-to-t from-brand-red/60 to-brand-red/20 group-hover:from-brand-red/80"
                          style={{ height: `${Math.max((s.views / maxViews) * 100, 2)}%` }} />
                        {s.completes > 0 && (
                          <div className="absolute bottom-0 w-[45%] max-w-[7px] rounded-t bg-emerald-500"
                            style={{ height: `${Math.max((s.completes / maxViews) * 100, 2)}%` }} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-[2px] mt-1">
                  {series.map((s, i) => (
                    <div key={s.date} className="flex-1 min-w-0 text-center text-[9px] text-muted-foreground truncate">
                      {i % labelEvery === 0 ? new Date(s.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric", timeZone: "UTC" }) : ""}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Biggest drop-off callout */}
          {data.biggestDrop && data.biggestDrop.dropPct > 0 && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>
                Biggest drop-off: <span className="font-semibold">Step {data.biggestDrop.step} · {data.biggestDrop.label}</span>
                {" "}— {data.biggestDrop.dropPct}% of visitors leave here ({data.biggestDrop.lost.toLocaleString()} people).
              </span>
            </div>
          )}

          {/* Step funnel */}
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
            How far visitors get
            {data.stepMode === "milestones" && (
              <span className="normal-case tracking-normal"> · both versions (milestones) — pick A or B above for each question</span>
            )}
          </div>
          <div className="space-y-2">
            {data.steps.map((s, i) => {
              const pctOfTop = top > 0 ? Math.round((s.count / top) * 100) : 0;
              return (
                <div key={s.step} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm text-right text-muted-foreground">{s.step}. {s.label}</div>
                  <div className="flex-1 h-8 rounded-md bg-slate-100 overflow-hidden relative">
                    <div className="h-full bg-gradient-to-r from-brand-red to-amber-400 flex items-center px-2"
                      style={{ width: `${Math.max(pctOfTop, 3)}%` }}>
                      <span className="text-xs font-semibold text-white drop-shadow">{s.count.toLocaleString()}</span>
                    </div>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">{pctOfTop}% of visitors</span>
                  </div>
                  <div className="w-24 shrink-0 text-xs text-right">
                    {i > 0 && (
                      <span className={cn(s.dropPct >= 40 ? "text-rose-600" : "text-muted-foreground")}>
                        {s.dropPct > 0 ? `−${s.dropPct}% drop` : "held"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {/* Completion row */}
            <div className="flex items-center gap-3 pt-1">
              <div className="w-28 shrink-0 text-sm text-right font-medium text-emerald-700">✓ Completed</div>
              <div className="flex-1 h-8 rounded-md bg-slate-100 overflow-hidden relative">
                <div className="h-full bg-emerald-500 flex items-center px-2"
                  style={{ width: `${Math.max(top > 0 ? Math.round((data.completes / top) * 100) : 0, 3)}%` }}>
                  <span className="text-xs font-semibold text-white drop-shadow">{data.completes.toLocaleString()}</span>
                </div>
              </div>
              <div className="w-24 shrink-0 text-xs text-right text-emerald-700 font-medium">{data.completionRate}%</div>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            100% = unique visitors who opened the page (step 1; repeat loads merged, Audience Network excluded) · each bar =
            visitors who reached that step · the drop % shows where people leave · overall completion rate ={" "}
            {data.completionRate}% of visitors. Data is first-party and anonymous.
          </p>
        </>
      )}
    </div>
  );
}
