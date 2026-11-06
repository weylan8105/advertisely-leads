"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Pills,
  PeriodPills,
  PersonAvatar,
  formatAp,
  type ActivityStats,
  type Period,
} from "@/components/activity/shared";

type Scope = "agents" | "teams" | "my-team";
type Metric = "apCents" | "policies" | "dials" | "contacts" | "presentations";

interface Row extends ActivityStats {
  id: string;
  name: string;
  image: string | null;
  subtitle: string | null;
  isMe: boolean;
}

const METRICS: { id: Metric; label: string }[] = [
  { id: "apCents", label: "Annual Premium" },
  { id: "policies", label: "Policies Sold" },
  { id: "dials", label: "Dials" },
  { id: "contacts", label: "Contacts" },
  { id: "presentations", label: "Presentations" },
];

const fmt = (m: Metric, r: ActivityStats) => (m === "apCents" ? formatAp(r.apCents) : r[m].toLocaleString());

export default function LeaderboardPage() {
  const [scope, setScope] = useState<Scope>("agents");
  const [period, setPeriod] = useState<Period>("mtd");
  const [metric, setMetric] = useState<Metric>("apCents");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [teamName, setTeamName] = useState<string | null>(null);
  const [hasTeam, setHasTeam] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Only offer "My team" to people who are on a team.
  useEffect(() => {
    fetch("/api/leaderboard?scope=my-team&period=mtd")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHasTeam(!!d?.team))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/leaderboard?scope=${scope}&period=${period}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "Couldn't load the leaderboard.");
        return d;
      })
      .then((d) => {
        if (!alive) return;
        setRows(d.rows ?? []);
        setTeamName(d.team?.name ?? null);
      })
      .catch((e) => { if (alive) setError((e as Error).message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [scope, period]);

  const ranked = useMemo(
    () =>
      [...(rows ?? [])].sort(
        (a, b) => b[metric] - a[metric] || b.apCents - a.apCents || b.policies - a.policies || a.name.localeCompare(b.name),
      ),
    [rows, metric],
  );
  const podium = ranked.slice(0, 3);
  const who = scope === "teams" ? "Team" : "Producer";

  const scopes: { id: Scope; label: string }[] = [
    { id: "agents", label: "All producers" },
    { id: "teams", label: "Teams" },
    ...(hasTeam ? [{ id: "my-team" as const, label: "My team" }] : []),
  ];

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-brand-red">Advertisely</div>
          <h1 className="font-serif text-4xl md:text-5xl tracking-tight">Leaderboard</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {scope === "teams"
              ? "Every team on Advertisely, ranked by its members' combined production."
              : scope === "my-team"
                ? `How everyone on ${teamName ?? "your team"} is producing.`
                : "Every producer working Advertisely leads, ranked."}
          </p>
        </div>
        <PeriodPills value={period} onChange={setPeriod} />
      </div>

      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Pills value={scope} onChange={setScope} options={scopes} />
        <Pills value={metric} onChange={setMetric} options={METRICS} />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      ) : rows === null ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading leaderboard…
        </div>
      ) : ranked.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-sm text-muted-foreground">
          No activity yet for this period.
        </div>
      ) : (
        <div className={cn("transition-opacity", loading && "opacity-60")}>
          <div className="grid gap-4 md:grid-cols-3">
            {podium.map((r, i) => (
              <div
                key={r.id}
                className={cn(
                  "flex flex-col items-center rounded-2xl bg-white px-6 py-8 text-center",
                  i === 0 ? "border-2 border-slate-900 shadow-sm" : "border border-slate-200",
                )}
              >
                <PersonAvatar name={r.name} image={r.image} className="h-16 w-16 text-base" />
                <div className="mt-4 text-xs font-semibold tracking-[0.2em] text-slate-500"># {i + 1}</div>
                <div className="mt-1 text-lg font-semibold">{r.name}</div>
                {r.subtitle && <div className="text-xs text-muted-foreground">{r.subtitle}</div>}
                <div className="mt-3 text-3xl font-semibold tabular-nums">{fmt(metric, r)}</div>
                {r.isMe && (
                  <span className="mt-3 rounded-full border border-slate-300 px-3 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]">
                    {scope === "teams" ? "Your team" : "You"}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-slate-900 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="w-16 px-5 py-4">Rank</th>
                  <th className="px-5 py-4">{who}</th>
                  <th className="px-5 py-4 text-right">AP</th>
                  <th className="px-5 py-4 text-right">Policies</th>
                  <th className="px-5 py-4 text-right">Dials</th>
                  <th className="px-5 py-4 text-right">Contacts</th>
                  <th className="px-5 py-4 text-right">Pres</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => (
                  <tr key={r.id} className={cn("border-b border-slate-100 last:border-0", r.isMe && "bg-amber-50/70")}>
                    <td className="px-5 py-4 text-slate-500 tabular-nums">{i + 1}</td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <PersonAvatar name={r.name} image={r.image} className="h-9 w-9" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">
                            {r.name}
                            {r.isMe && <span className="ml-2 text-xs font-medium text-brand-red">{scope === "teams" ? "your team" : "you"}</span>}
                          </div>
                          {r.subtitle && <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold tabular-nums">{formatAp(r.apCents)}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{r.policies}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{r.dials}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{r.contacts}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{r.presentations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Policies and AP count Issued PAID deals. Dials count every call started from Advertisely since Nov 6, and one per lead moved before that. Contacts and presentations count leads moved to those
            pipeline stages in the period. Central time.
          </p>
        </div>
      )}
    </div>
  );
}
