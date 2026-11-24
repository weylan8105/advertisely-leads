"use client";

import { useEffect, useState } from "react";
import { BarChart3, ChevronDown, Download } from "lucide-react";
import { Card } from "@/components/ui/card";
import { downloadCsv } from "@/components/admin/csv";
import { Pills } from "@/components/activity/shared";
import { CustomRangeInputs, customRangeQuery, defaultDayRange, type DayRange } from "@/components/activity/CustomRange";
import { LiveDot, LiveStatsGrid, updatedLabel, useLiveStats, type LiveStatsPayload, type LiveTotals } from "@/components/marketing/LiveStats";
import { cn } from "@/lib/utils";

interface AgentRow extends LiveTotals {
  id: string;
  name: string;
  role: "OWNER" | "ADMIN" | "AGENT";
  isSelf: boolean;
}
interface TeamPayload extends LiveStatsPayload {
  team: string;
  members: number;
  agents: AgentRow[];
}

type Range = "today" | "yesterday" | "7d" | "30d" | "all" | "custom";
const RANGES: { id: Range; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];
const RANGE_NOTE: Record<Range, string> = {
  today: "Today so far (Central time)",
  yesterday: "Yesterday (Central time)",
  "7d": "Last 7 days, including today (Central time)",
  "30d": "Last 30 days",
  all: "All time",
  custom: "Custom range, both days included (Central time)",
};

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const num = (n: number) => n.toLocaleString("en-US");

const COLUMNS: { label: string; text: (a: LiveTotals) => string; csv: (a: LiveTotals) => string | number }[] = [
  { label: "Leads", text: (a) => num(a.leads), csv: (a) => a.leads },
  { label: "Dials", text: (a) => num(a.dials), csv: (a) => a.dials },
  { label: "Contacts", text: (a) => num(a.contacts), csv: (a) => a.contacts },
  { label: "Appointments", text: (a) => num(a.appointments), csv: (a) => a.appointments },
  { label: "Presentations", text: (a) => num(a.presentations), csv: (a) => a.presentations },
  { label: "Apps", text: (a) => num(a.apps), csv: (a) => a.apps },
  { label: "Submitted AP", text: (a) => money(a.submittedApCents), csv: (a) => (a.submittedApCents / 100).toFixed(2) },
  { label: "Policies", text: (a) => num(a.policies), csv: (a) => a.policies },
  { label: "Issued AP", text: (a) => money(a.apCents), csv: (a) => (a.apCents / 100).toFixed(2) },
];

const OPEN_KEY = "team:performance-open";
const RANGE_KEY = "team:performance-range";

/** Team page, team leaders only: every member's production for a range. */
export function TeamPerformancePanel() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<Range>("30d");
  const [custom, setCustom] = useState<DayRange>(defaultDayRange);

  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
      const r = localStorage.getItem(RANGE_KEY) as Range | null;
      if (r && RANGES.some((x) => x.id === r) && r !== "custom") setRange(r);
    } catch {
      /* storage blocked: defaults are fine */
    }
  }, []);
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });
  const pickRange = (r: Range) => {
    setRange(r);
    try {
      localStorage.setItem(RANGE_KEY, r);
    } catch {}
  };

  return (
    <Card className="p-0 overflow-hidden">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left hover:bg-slate-50"
      >
        <span>
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <BarChart3 className="h-4 w-4 text-brand-red" /> Team performance
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">
            Leads, dials, contacts, apps and AP for each of your agents, for any date range.
          </span>
        </span>
        <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-slate-100 px-6 py-5">
          <TeamPerformanceBody range={range} setRange={pickRange} custom={custom} setCustom={setCustom} />
        </div>
      )}
    </Card>
  );
}

function TeamPerformanceBody({
  range,
  setRange,
  custom,
  setCustom,
}: {
  range: Range;
  setRange: (r: Range) => void;
  custom: DayRange;
  setCustom: (r: DayRange) => void;
}) {
  const url = `/api/team/performance?range=${range}${range === "custom" ? customRangeQuery(custom) : ""}`;
  const { data: raw, failed, url: loadedUrl } = useLiveStats<TeamPayload>(url);
  const data = raw && loadedUrl === url ? raw : null;

  function exportCsv() {
    if (!data) return;
    const rangeLabel = range === "custom" ? `${custom.from}_${custom.to}` : range;
    downloadCsv(
      `team-performance-${rangeLabel}.csv`,
      ["Agent", ...COLUMNS.map((c) => c.label)],
      [...data.agents.map((a) => [a.name, ...COLUMNS.map((c) => c.csv(a))]), ["Whole team", ...COLUMNS.map((c) => c.csv(data.totals))]],
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <Pills value={range} onChange={setRange} options={RANGES} />
        {range === "custom" && <CustomRangeInputs value={custom} onApply={setCustom} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <LiveDot /> {RANGE_NOTE[range]} · refreshes every 30 seconds
        </span>
        <span>
          {failed && !data
            ? "Couldn't load your team's numbers"
            : data
              ? `${data.activeAgents} of ${data.members} active · updated ${updatedLabel(data.generatedAt)}`
              : "Loading…"}
        </span>
      </div>

      <LiveStatsGrid totals={data?.totals ?? null} />

      {data && data.agents.length > 0 && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={exportCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium hover:border-slate-400"
            >
              <Download className="h-4 w-4" /> Export CSV
            </button>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Agent</th>
                  {COLUMNS.map((c) => (
                    <th key={c.label} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.agents.map((a) => (
                  <tr key={a.id} className={cn("border-t border-slate-100", a.isSelf && "bg-sky-50/60")}>
                    <td className="min-w-[10rem] px-3 py-2">
                      <span className="font-medium">{a.name}</span>
                      {a.isSelf && <span className="text-muted-foreground"> (you)</span>}
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={c.label} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                        {c.text(a)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                  <td className="px-3 py-2">Whole team</td>
                  {COLUMNS.map((c) => (
                    <td key={c.label} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {c.text(data.totals)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Same counting as the leaderboard: leads by when they were assigned, dials as real call attempts, apps and AP by
            when the deal was submitted or paid. Most submitted AP first.
          </p>
        </>
      )}
    </div>
  );
}
