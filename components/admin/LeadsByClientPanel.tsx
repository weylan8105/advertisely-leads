"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { ClientDayRow, LeadsByClient } from "@/lib/leadsByClient";

const TZ = "America/Chicago";
const OPEN_KEY = "lead-pace:by-client-open";
const RANGE_KEY = "lead-pace:by-client-range";

const ymdCentral = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const monthStart = (ymd: string) => `${ymd.slice(0, 7)}-01`;
const shortDate = (ymd: string, year = false) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const monthLabel = (ym: string) =>
  new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

type Preset = "today" | "yesterday" | "7d" | "30d" | "month" | "last-month" | "all" | "custom";
const PRESETS: { id: Preset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom range…" },
];

function rangeOf(p: Preset, today: string): [string, string] | null {
  switch (p) {
    case "today": return [today, today];
    case "yesterday": { const y = addDays(today, -1); return [y, y]; }
    case "7d": return [addDays(today, -6), today];
    case "30d": return [addDays(today, -29), today];
    case "month": return [monthStart(today), today];
    case "last-month": { const end = addDays(monthStart(today), -1); return [monthStart(end), end]; }
    case "all": return ["2025-01-01", today];
    default: return null;
  }
}

/** The days (or, for long ranges, months) a client got leads, as small cells. */
function Breakdown({ row, from, to, days }: { row: ClientDayRow; from: string; to: string; days: number }) {
  if (!row.total) return <p className="text-xs text-slate-500">No leads in this range.</p>;
  if (days <= 62) {
    const cells: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) cells.push(d);
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5">
        {cells.map((d) => {
          const n = row.byDay[d] ?? 0;
          return (
            <div key={d} className={cn("rounded-md border px-2 py-1 text-center", n ? "border-slate-200 bg-white" : "border-transparent bg-slate-100/60 text-slate-400")}>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{weekday(d)} {shortDate(d)}</div>
              <div className="text-sm font-semibold tabular-nums">{n || "·"}</div>
            </div>
          );
        })}
      </div>
    );
  }
  const months = new Map<string, { n: number; days: number }>();
  for (const [d, n] of Object.entries(row.byDay)) {
    const m = months.get(d.slice(0, 7)) ?? { n: 0, days: 0 };
    m.n += n;
    m.days++;
    months.set(d.slice(0, 7), m);
  }
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1.5">
      {[...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, v]) => (
        <div key={m} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-center">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">{monthLabel(m)}</div>
          <div className="text-sm font-semibold tabular-nums">{v.n}</div>
          <div className="text-[10px] text-slate-500">{v.days} {v.days === 1 ? "day" : "days"}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Lead Pace → "Leads by client": every client's lead count for any date range,
 * most first. Collapsed by default so the page stays clean; click a client to
 * see their day-by-day breakdown.
 */
export function LeadsByClientPanel() {
  const today = ymdCentral();
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<Preset>("month");
  const [customFrom, setCustomFrom] = useState(monthStart(today));
  const [customTo, setCustomTo] = useState(today);
  const [data, setData] = useState<LeadsByClient | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "1") setOpen(true);
      const r = localStorage.getItem(RANGE_KEY) as Preset | null;
      if (r && PRESETS.some((p) => p.id === r)) setPreset(r);
    } catch {}
  }, []);

  const range = useMemo<[string, string]>(
    () => rangeOf(preset, today) ?? [customFrom, customTo],
    [preset, today, customFrom, customTo],
  );

  const load = useCallback(async (from: string, to: string) => {
    if (!from || !to || from > to) {
      setError(from > to ? "The start date is after the end date." : null);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/lead-pace/clients?from=${from}&to=${to}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load leads by client");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load leads by client");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load(range[0], range[1]);
  }, [open, range, load]);

  function toggle() {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(OPEN_KEY, next ? "1" : "0"); } catch {}
  }
  function pick(p: Preset) {
    setPreset(p);
    setExpanded(null);
    try { localStorage.setItem(RANGE_KEY, p); } catch {}
  }

  const clients = data?.rows.filter((r) => !r.admin) ?? [];
  const admins = data?.rows.filter((r) => r.admin) ?? [];
  const singleDay = data ? data.days === 1 : false;
  const rangeText = data
    ? data.from === data.to
      ? shortDate(data.from, true)
      : `${shortDate(data.from, data.from.slice(0, 4) !== data.to.slice(0, 4))} – ${shortDate(data.to, true)}`
    : "";
  const cols = singleDay ? 3 : 6;

  const renderRow = (r: ClientDayRow, i: number | null) => (
    <Fragment key={r.userId}>
      <TableRow
        onClick={() => setExpanded(expanded === r.userId ? null : r.userId)}
        className={cn("cursor-pointer", r.admin && "text-slate-500", !r.total && !r.admin && "text-slate-400")}
      >
        <TableCell className="w-10 text-right tabular-nums text-slate-400">{i ?? ""}</TableCell>
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform", expanded === r.userId && "rotate-90")} />
            {r.name}
            {r.admin && <span className="rounded-full border border-slate-200 px-1.5 text-[10px] font-normal">Admin</span>}
          </span>
        </TableCell>
        <TableCell className="text-right font-semibold tabular-nums">{r.total}</TableCell>
        {!singleDay && (
          <>
            <TableCell className="text-right tabular-nums">{r.avgPerDay.toFixed(1)}</TableCell>
            <TableCell className="text-right tabular-nums whitespace-nowrap">
              {r.bestDay ? <>{r.bestDay.n} <span className="text-xs text-slate-500">({shortDate(r.bestDay.day)})</span></> : "—"}
            </TableCell>
            <TableCell className="text-right tabular-nums">{r.daysWithLeads}</TableCell>
          </>
        )}
      </TableRow>
      {expanded === r.userId && data && !singleDay && (
        <TableRow className="hover:bg-transparent">
          <TableCell />
          <TableCell colSpan={cols - 1} className="bg-slate-50/70">
            <Breakdown row={r} from={data.from} to={data.to} days={data.days} />
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );

  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 p-5">
        <button onClick={toggle} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={open}>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-slate-500 transition-transform", !open && "-rotate-90")} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Leads by client</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {open && data
                ? `${rangeText} · ${data.clientTotal.toLocaleString()} leads to ${clients.filter((c) => c.total).length} of ${clients.length} clients`
                : "Every client's lead count for any day, month or custom range."}
            </p>
          </div>
        </button>
        {open && (
          <div className="flex flex-wrap items-center gap-2">
            {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <select
              value={preset}
              onChange={(e) => pick(e.target.value as Preset)}
              className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm outline-none focus:border-slate-400"
              aria-label="Date range"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            {preset === "custom" && (
              <>
                <input type="date" value={customFrom} max={today} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-sm" aria-label="From" />
                <span className="text-xs text-slate-500">to</span>
                <input type="date" value={customTo} max={today} onChange={(e) => setCustomTo(e.target.value)} className="h-8 rounded-md border border-slate-200 px-2 text-sm" aria-label="To" />
              </>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-slate-100 px-5 pb-5 pt-3">
          {error && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
              <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
            </div>
          )}
          {!data ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (
            <div className={cn("overflow-x-auto transition-opacity", loading && "opacity-60")}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead className="min-w-[180px]">Client</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    {!singleDay && (
                      <>
                        <TableHead className="text-right">Avg a day</TableHead>
                        <TableHead className="text-right">Best day</TableHead>
                        <TableHead className="text-right">Days with leads</TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((r, i) => renderRow(r, i + 1))}
                  {admins.map((r) => renderRow(r, null))}
                  <TableRow className="bg-slate-50 font-medium hover:bg-slate-50">
                    <TableCell />
                    <TableCell>All leads</TableCell>
                    <TableCell className="text-right tabular-nums">{data.total.toLocaleString()}</TableCell>
                    {!singleDay && (
                      <>
                        <TableCell className="text-right tabular-nums">{(data.total / data.days).toFixed(1)}</TableCell>
                        <TableCell colSpan={2} />
                      </>
                    )}
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-slate-500">
                Leads by the Central-time day they were assigned, under whoever holds them now (trashed leads left out).
                {!singleDay && " Click a client to see each day."} Admins are listed after clients.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
