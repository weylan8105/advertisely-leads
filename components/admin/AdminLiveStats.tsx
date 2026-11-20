"use client";

import { useState } from "react";
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
      <LiveStatsGrid totals={data?.totals ?? null} />
      {range === "30d" && (
        <p className="text-xs text-muted-foreground">
          These tiles are what visitors see on the advertisely.io homepage before they sign in (totals only, no names).
        </p>
      )}
      {data && data.agents.length === 0 && (
        <p className="text-sm text-muted-foreground">No agent activity in this range yet.</p>
      )}
      {data && data.agents.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-muted-foreground">
              <tr>
                {["Agent", "Leads", "Dials", "Contacts", "Appts", "Apps", "Submitted AP", "Policies", "Issued AP"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.agents.map((a) => (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{a.name}</td>
                  {[a.leads, a.dials, a.contacts, a.appointments, a.apps].map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">{v.toLocaleString("en-US")}</td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{money(a.submittedApCents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{a.policies.toLocaleString("en-US")}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(a.apCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
