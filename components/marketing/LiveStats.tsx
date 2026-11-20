"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface LiveTotals {
  leads: number;
  dials: number;
  contacts: number;
  appointments: number;
  presentations: number;
  apps: number;
  submittedApCents: number;
  policies: number;
  apCents: number;
}

export interface LiveStatsPayload {
  totals: LiveTotals;
  activeAgents: number;
  since: string;
  generatedAt: string;
}

export const REFRESH_MS = 30_000;

const num = (n: number) => n.toLocaleString("en-US");
const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** Which lead list a tile opens on Client Performance (none for Dials). */
export type TileMetric = "leads" | "contacts" | "appointments" | "apps" | "policies";

export function liveTiles(t: LiveTotals): { label: string; value: string; accent?: boolean; metric?: TileMetric }[] {
  return [
    { label: "Submitted AP", value: money(t.submittedApCents), accent: true, metric: "apps" },
    { label: "Apps submitted", value: num(t.apps), metric: "apps" },
    { label: "Issued AP", value: money(t.apCents), accent: true, metric: "policies" },
    { label: "Policies issued", value: num(t.policies), metric: "policies" },
    { label: "Leads delivered", value: num(t.leads), metric: "leads" },
    { label: "Dials", value: num(t.dials) },
    { label: "Contacts", value: num(t.contacts), metric: "contacts" },
    { label: "Appointments", value: num(t.appointments), metric: "appointments" },
  ];
}

/** Polls `url` every 30s while the tab is visible. */
export function useLiveStats<T extends LiveStatsPayload>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const latest = useRef(url);
  latest.current = url;
  const load = useCallback(() => {
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: T) => {
        if (latest.current !== url) return; // a newer range was picked meanwhile
        setData(d); setLoadedUrl(url); setFailed(false);
      })
      .catch(() => { if (latest.current === url) setFailed(true); });
  }, [url]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    const onVis = () => { if (document.visibilityState === "visible") load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [load]);
  return { data, failed, url: loadedUrl };
}

export function LiveDot() {
  return (
    <span className="relative flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  );
}

export function LiveStatsGrid({
  totals,
  onSelect,
}: {
  totals: LiveTotals | null;
  /** Admin only: makes tiles clickable to open the leads behind them. */
  onSelect?: (metric: TileMetric, label: string) => void;
}) {
  const tiles = liveTiles(totals ?? { leads: 0, dials: 0, contacts: 0, appointments: 0, presentations: 0, apps: 0, submittedApCents: 0, policies: 0, apCents: 0 });
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((s) => {
        const clickable = !!(onSelect && s.metric && totals);
        const Tag = clickable ? "button" : "div";
        return (
        <Tag
          key={s.label}
          {...(clickable ? { type: "button" as const, onClick: () => onSelect!(s.metric!, s.label), title: `See the leads behind ${s.label}` } : {})}
          className={cn(
            "rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm",
            clickable && "transition hover:border-slate-400 hover:shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400",
          )}
        >
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.label}</div>
          <div
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              s.accent && "text-brand-red",
              !totals && "animate-pulse text-slate-300",
            )}
          >
            {totals ? s.value : "—"}
          </div>
          {clickable && <div className="mt-0.5 text-[11px] text-slate-400">View leads →</div>}
        </Tag>
        );
      })}
    </div>
  );
}

export function updatedLabel(iso: string | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Homepage strip: real production across every Advertisely agent, last 30 days. */
export function LiveStats() {
  const { data, failed } = useLiveStats<LiveStatsPayload>("/api/stats/live");
  // Nothing to show (no DB, error before first load): hide rather than show zeros.
  if (failed && !data) return null;
  return (
    <section className="border-b border-slate-200 bg-slate-50/70">
      <div className="container py-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">
              <LiveDot /> Live
            </div>
            <h2 className="mt-1 text-xl font-semibold sm:text-2xl">What agents produced on Advertisely in the last 30 days</h2>
          </div>
          {data && (
            <div className="text-xs text-muted-foreground">
              {num(data.activeAgents)} active agents · updated {updatedLabel(data.generatedAt)}
            </div>
          )}
        </div>
        <LiveStatsGrid totals={data?.totals ?? null} />
        <p className="mt-3 text-xs text-muted-foreground">
          Real numbers from agents working Advertisely leads, rolling 30 days, refreshed every 30 seconds.
          Submitted AP is annual premium on applications agents have submitted; results vary by agent.
        </p>
      </div>
    </section>
  );
}
