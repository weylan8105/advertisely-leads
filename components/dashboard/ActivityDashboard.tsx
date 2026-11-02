"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { PeriodPills, formatAp, pct, type ActivityStats, type Period } from "@/components/activity/shared";

/**
 * Activity Dashboard — the agent's own funnel for a period: Leads → Dials →
 * Contacts → Appointments → Presentations → Policies, plus AP.
 * Numbers come from /api/activity (lib/activityStats.ts).
 */
export function ActivityDashboard() {
  const [period, setPeriod] = useState<Period>("mtd");
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/activity?period=${period}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setStats(d?.stats ?? null); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const s = stats ?? { leads: 0, dials: 0, contacts: 0, appointments: 0, presentations: 0, policies: 0, apCents: 0 };
  const tiles: { label: string; value: string; hint?: string }[] = [
    { label: "Leads", value: String(s.leads) },
    { label: "Dials", value: String(s.dials) },
    { label: "Contacts", value: String(s.contacts), hint: `${pct(s.contacts, s.dials)} of dials` },
    { label: "Appointments", value: String(s.appointments), hint: `${pct(s.appointments, s.contacts)} of contacts` },
    { label: "Presentations", value: String(s.presentations), hint: `${pct(s.presentations, s.appointments)} of appts` },
    { label: "Policies", value: String(s.policies), hint: `${pct(s.policies, s.presentations)} close` },
  ];

  return (
    <section className="mt-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl md:text-3xl tracking-tight">Activity Dashboard</h2>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <Link href="/leaderboard" className="inline-flex items-center gap-1 text-xs font-medium text-brand-red hover:underline">
            <Trophy className="h-3.5 w-3.5" /> Leaderboard
          </Link>
        </div>
        <PeriodPills value={period} onChange={setPeriod} />
      </div>
      <div className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7 transition-opacity", loading && stats && "opacity-60")}>
        {tiles.map((t) => (
          <div key={t.label} className="flex min-h-[132px] flex-col rounded-xl border border-slate-200 bg-white p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{t.label}</div>
            <div className="mt-2 text-3xl font-semibold tabular-nums">{t.value}</div>
            {t.hint && <div className="mt-auto pt-3 text-xs text-slate-500">{t.hint}</div>}
          </div>
        ))}
        <div className="col-span-2 flex min-h-[132px] flex-col rounded-xl bg-slate-900 p-5 text-white sm:col-span-4 lg:col-span-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/60">AP</div>
          <div className="mt-2 text-3xl font-semibold tabular-nums">{formatAp(s.apCents)}</div>
          <div className="mt-auto pt-3 text-xs text-white/60">Annual premium, Issued PAID</div>
        </div>
      </div>
    </section>
  );
}
