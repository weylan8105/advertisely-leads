"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { ClientLeadsWindow, type DrillRequest } from "@/components/admin/ClientLeadsWindow";
import { downloadCsv } from "@/components/admin/csv";
import { Pills } from "@/components/activity/shared";
import { CustomRangeInputs, customRangeQuery, defaultDayRange, type DayRange } from "@/components/activity/CustomRange";
import { LiveDot, LiveStatsGrid, updatedLabel, useLiveStats, type LiveStatsPayload, type LiveTotals } from "@/components/marketing/LiveStats";

interface AgentRow extends LiveTotals { id: string; name: string }
interface AdminPayload extends LiveStatsPayload { agents: AgentRow[] }

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

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
  "30d": "Rolling last 30 days, the same window as the homepage",
  all: "All time",
  custom: "Custom range, both days included (Central time)",
};

/** Client Performance page: every agent's production for a range, live. */
export function AdminLiveStats() {
  const [range, setRange] = useState<Range>("30d");
  const [custom, setCustom] = useState<DayRange>(defaultDayRange);
  const url = `/api/admin/live-stats?range=${range}${range === "custom" ? customRangeQuery(custom) : ""}`;
  const { data: raw, failed, url: loadedUrl } = useLiveStats<AdminPayload & { range?: Range }>(url);
  // Don't show the previous range's numbers under the new range's button.
  const data = raw && loadedUrl === url ? raw : null;
  const [drill, setDrill] = useState<DrillRequest | null>(null);
  const rangeQuery = `range=${range}${range === "custom" ? customRangeQuery(custom) : ""}`;
  const rangeName = range === "custom" ? `${custom.from} to ${custom.to}` : RANGES.find((r) => r.id === range)!.label;
  const openDrill = (metric: string, label: string, count: number, agent: { id: string; name: string } | null) =>
    setDrill({ metric, title: `${label} · ${agent ? agent.name : "All agents"} · ${rangeName}`, count, userId: agent?.id ?? null, query: rangeQuery });

  function exportCsv() {
    if (!data) return;
    const t = data.totals;
    const row = (name: string, a: LiveTotals) => [
      name, a.leads, a.dials, a.contacts, a.presentations, a.apps,
      (a.submittedApCents / 100).toFixed(2), a.policies, (a.apCents / 100).toFixed(2),
    ];
    downloadCsv(
      `client-performance-${range === "custom" ? `${custom.from}_${custom.to}` : range}.csv`,
      ["Agent", "Leads", "Dials", "Contacts", "Presentations", "Apps", "Submitted AP", "Policies", "Issued AP"],
      [...data.agents.map((a) => row(a.name, a)), row("All agents", t)],
    );
  }
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Pills value={range} onChange={setRange} options={RANGES} />
        {range === "custom" && <CustomRangeInputs value={custom} onApply={setCustom} />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><LiveDot /> {RANGE_NOTE[range]} · refreshes every 30 seconds</span>
        <span>
          {failed && !data ? "Couldn't load stats" : data ? `${data.activeAgents} active agents · updated ${updatedLabel(data.generatedAt)}` : "Loading…"}
        </span>
      </div>
      <LiveStatsGrid
        totals={data?.totals ?? null}
        onSelect={(metric, label) => data && openDrill(metric, label, metric === "apps" ? data.totals.apps : metric === "policies" ? data.totals.policies : (data.totals as any)[metric], null)}
      />
      {range === "30d" && (
        <p className="text-xs text-muted-foreground">
          These tiles are what visitors see on the advertisely.io homepage before they sign in (totals only, no names).
        </p>
      )}
      {data && data.agents.length === 0 && (
        <p className="text-sm text-muted-foreground">No agent activity in this range yet.</p>
      )}
      {data && data.agents.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Click any underlined number to see the lead cards behind it.</p>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium hover:border-slate-400"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      )}
      {data && data.agents.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
              <tr>
                {["Agent", "Leads", "Dials", "Contacts", "Presentations", "Apps", "Submitted AP", "Policies", "Issued AP"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{a.name}</td>
                  {(
                    [
                      ["leads", "Leads", a.leads, a.leads.toLocaleString("en-US")],
                      [null, "Dials", a.dials, a.dials.toLocaleString("en-US")],
                      ["contacts", "Contacts", a.contacts, a.contacts.toLocaleString("en-US")],
                      ["presentations", "Presentations", a.presentations, a.presentations.toLocaleString("en-US")],
                      ["apps", "Apps", a.apps, a.apps.toLocaleString("en-US")],
                      ["apps", "Submitted AP", a.apps, money(a.submittedApCents)],
                      ["policies", "Policies", a.policies, a.policies.toLocaleString("en-US")],
                      ["policies", "Issued AP", a.policies, money(a.apCents)],
                    ] as [string | null, string, number, string][]
                  ).map(([metric, label, count, text]) => (
                    <td key={label} className="px-3 py-2 text-right tabular-nums">
                      {metric && count > 0 ? (
                        <button
                          type="button"
                          onClick={() => openDrill(metric, label, count, a)}
                          className="underline decoration-slate-300 underline-offset-2 hover:text-brand-red hover:decoration-current"
                        >
                          {text}
                        </button>
                      ) : (
                        text
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drill && <ClientLeadsWindow req={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}
