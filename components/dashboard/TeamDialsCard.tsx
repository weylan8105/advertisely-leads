"use client";

import { useEffect, useState } from "react";
import { PhoneOutgoing, Moon } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Dials { dials: number; leads: number }
interface Member { userId: string; name: string; isLeader: boolean; today: Dials; report: Dials }
interface Team { teamId: string; teamName: string; members: Member[] }
interface Report {
  now: string;
  report: { day: string; start: string; end: string; isToday: boolean };
  teams: Team[];
}

const REFRESH_MS = 60_000;

const dayLabel = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Team dials for uplines (lib/teamDials.ts): each member's dials today, live,
 * and the 9 pm Central daily report. Renders nothing for agents who don't lead
 * a team with members.
 */
export function TeamDialsCard({ className }: { className?: string }) {
  const [data, setData] = useState<Report | null | undefined>(undefined);
  const [view, setView] = useState<"today" | "report" | null>(null);
  const [teamId, setTeamId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/team/dials")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setData(d?.report ?? null); })
        .catch(() => { if (alive) setData((prev) => prev ?? null); });
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (data === undefined || data === null) return null;

  // From 9 pm the day's report opens first; before that, today's live numbers.
  const shown = view ?? (data.report.isToday ? "report" : "today");
  const team = data.teams.find((t) => t.teamId === teamId) ?? data.teams[0];
  const pick = (m: Member) => (shown === "today" ? m.today : m.report);
  const rows = [...team.members].sort((a, b) => pick(b).dials - pick(a).dials || a.name.localeCompare(b.name));
  const total = rows.reduce((s, m) => s + pick(m).dials, 0);
  const totalLeads = rows.reduce((s, m) => s + pick(m).leads, 0);
  const max = Math.max(1, ...rows.map((m) => pick(m).dials));

  return (
    <Card className={cn(data.report.isToday && "border-brand-red/40", className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <PhoneOutgoing className="h-4 w-4 text-brand-red" /> Team dials
            </CardTitle>
            <CardDescription>
              {shown === "today"
                ? "Today so far, updates every minute."
                : `Daily report for ${dayLabel(data.report.day)}, midnight to 9 pm Central.`}{" "}
              A copied number counts as 2 dials.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.teams.length > 1 && (
              <select
                value={team.teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs"
                aria-label="Team"
              >
                {data.teams.map((t) => (
                  <option key={t.teamId} value={t.teamId}>{t.teamName}</option>
                ))}
              </select>
            )}
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {(["today", "report"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium",
                    shown === v ? "bg-brand-red text-white" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {v === "today" ? "Today" : "9 pm report"}
                </button>
              ))}
            </div>
          </div>
        </div>
        {data.report.isToday && shown === "report" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-brand-red/5 px-3 py-2 text-xs text-brand-red">
            <Moon className="h-3.5 w-3.5" /> Today&apos;s end-of-day report is in.
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Agent</th>
                <th className="py-2 pr-3 text-right font-medium">Dials</th>
                <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Leads dialed</th>
                <th className="hidden w-1/3 py-2 md:table-cell" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const d = pick(m);
                return (
                  <tr key={m.userId} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 pr-3">
                      <span className={cn(d.dials === 0 && "text-muted-foreground")}>{m.name}</span>
                      {m.isLeader && <span className="ml-2 text-[11px] text-muted-foreground">Team leader</span>}
                    </td>
                    <td className={cn("py-2 pr-3 text-right font-semibold tabular-nums", d.dials === 0 && "text-rose-600")}>{d.dials}</td>
                    <td className="hidden py-2 pr-3 text-right tabular-nums text-muted-foreground sm:table-cell">{d.leads}</td>
                    <td className="hidden py-2 md:table-cell">
                      <div className="h-1.5 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-brand-red" style={{ width: `${(d.dials / max) * 100}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200">
                <td className="py-2 pr-3 font-semibold">Team total</td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">{total}</td>
                <td className="hidden py-2 pr-3 text-right tabular-nums text-muted-foreground sm:table-cell">{totalLeads}</td>
                <td className="hidden md:table-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
