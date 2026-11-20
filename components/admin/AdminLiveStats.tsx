"use client";

import { LiveDot, LiveStatsGrid, updatedLabel, useLiveStats, type LiveStatsPayload, type LiveTotals } from "@/components/marketing/LiveStats";

interface AgentRow extends LiveTotals { id: string; name: string }
interface AdminPayload extends LiveStatsPayload { agents: AgentRow[] }

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Admin console tab: the homepage's live 30-day numbers, plus who produced them. */
export function AdminLiveStats() {
  const { data, failed } = useLiveStats<AdminPayload>("/api/admin/live-stats");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><LiveDot /> Rolling last 30 days · refreshes every 30 seconds</span>
        <span>
          {failed && !data ? "Couldn't load stats" : data ? `${data.activeAgents} active agents · updated ${updatedLabel(data.generatedAt)}` : "Loading…"}
        </span>
      </div>
      <LiveStatsGrid totals={data?.totals ?? null} />
      <p className="text-xs text-muted-foreground">
        These tiles are what visitors see on the advertisely.io homepage before they sign in (totals only, no names).
      </p>
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
