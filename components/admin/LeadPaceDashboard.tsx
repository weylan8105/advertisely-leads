"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { LeadPaceResult } from "@/lib/leadPace";
import type { PaceRow, PaceStatus } from "@/lib/leadPaceMath";
import { LeadsByClientPanel } from "./LeadsByClientPanel";

const REFRESH_MS = 60_000;

const money = (cents: number | null | undefined) => {
  if (cents == null) return "—";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(dollars) >= 1000 ? 0 : 2,
  });
};
const num = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const shortDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekday = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });

const STATUS: Record<PaceStatus, { label: string; className: string }> = {
  "on-target": { label: "On target", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  "below-target": { label: "Below target", className: "bg-amber-50 text-amber-800 border-amber-200" },
  "below-floor": { label: "Starved", className: "bg-red-50 text-red-700 border-red-200" },
  inactive: { label: "Not active", className: "bg-slate-50 text-slate-500 border-slate-200" },
};

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cn("flex min-h-[124px] flex-col rounded-xl p-5", strong ? "bg-slate-900 text-white" : "border border-slate-200 bg-white")}>
      <div className={cn("text-[11px] font-semibold uppercase tracking-[0.16em]", strong ? "text-white/60" : "text-slate-500")}>{label}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className={cn("mt-auto pt-3 text-xs", strong ? "text-white/60" : "text-slate-500")}>{hint}</div>}
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: PaceStatus }) {
  const s = STATUS[status];
  return <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", s.className)}>{s.label}</span>;
}

/** A day's count, tinted by how it sits against the target. */
function DayCell({ n, target, floor, muted }: { n: number; target: number; floor: number; muted?: boolean }) {
  return (
    <TableCell
      className={cn(
        "text-right tabular-nums",
        muted || n === 0 ? "text-slate-400" : n >= target ? "text-emerald-700" : n >= floor ? "text-slate-900" : "text-red-700",
      )}
    >
      {n || "·"}
    </TableCell>
  );
}

const typesOf = (r: PaceRow) => [r.blueCollar && "Blue Collar", r.nurse && "Nurse"].filter(Boolean).join(" + ") || "—";

export function LeadPaceDashboard() {
  const [data, setData] = useState<LeadPaceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/lead-pace", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Could not load lead pace");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load lead pace");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const header = (
    <PageHeader
      eyebrow="Internal · Advertisely Admin"
      title="Lead Pace"
      description="Leads delivered per client per day against the target, and the ad spend that keeps up with demand. Refreshes every minute."
      className="mb-5"
    />
  );

  if (!data) {
    return (
      <div>
        {header}
        {error ? (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading lead pace…
          </div>
        )}
      </div>
    );
  }

  const s = data.summary;
  const span = `${shortDate(data.avgWindow[0])} to ${shortDate(data.avgWindow[data.avgWindow.length - 1])}`;
  const short = s.gapPerDay > 0;
  const over = s.surplusPerDay > 0;
  const change = s.spendChangePerDayCents;
  const active = data.rows.filter((r) => r.active);
  const inactive = data.rows.filter((r) => !r.active);

  let verdict: string;
  if (!s.activeClients) verdict = "No clients can take a lead right now.";
  else if (short) {
    verdict = `Clients are ${num(s.gapPerDay)} leads a day short of ${data.target} each.`;
    if (change != null) verdict += ` Closing it takes about ${money(change)} more ad spend a day (${num(s.leadsToAddPerDay)} more leads, since the house turn takes ${Math.round((1 - s.clientShare) * 100)}%).`;
  } else if (over) {
    verdict = `Clients are ${num(s.surplusPerDay)} leads a day over ${data.target} each.`;
    if (change != null) verdict += ` About ${money(-change)} a day of ad spend could come off and still hold the target.`;
  } else verdict = `Clients are right on ${data.target} leads a day each.`;

  return (
    <div className="space-y-5">
      {header}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Showing the last numbers loaded. {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <Tile
          strong
          label="Leads per active client a day"
          value={num(s.perActiveClient)}
          hint={`Target ${data.target} · ${span}`}
        />
        <Tile
          label="Ad spend left for clients"
          value={money(s.budgetLeftCents)}
          hint={`${s.budgetClients} clients with budget · ${money(s.activeBudgetLeftCents)} of it with active clients`}
        />
        <Tile
          label="Active clients"
          value={String(s.activeClients)}
          hint={`${s.onTarget} on target · ${s.belowTarget} below target · ${s.belowFloor} under ${data.floor} a day`}
        />
        <Tile
          label="Leads a day to clients"
          value={num(s.clientLeadsPerDay)}
          hint={`${s.neededPerDay} needed for ${s.activeClients} clients · house turn ${num(s.houseLeadsPerDay)} a day`}
        />
        <Tile
          label={short ? "Ad spend to add a day" : over ? "Ad spend that could come off a day" : "Ad spend change a day"}
          value={change == null ? "—" : money(Math.abs(change))}
          hint={
            data.spendKnown && s.spendPerDayCents != null
              ? `Spending ${money(s.spendPerDayCents)} a day at ${money(s.costPerLeadCents)} a lead${s.dailyBudgetCents ? ` · budgets total ${money(s.dailyBudgetCents)}` : ""}`
              : "Ad spend can't be read here"
          }
        />
      </div>

      <div
        className={cn(
          "rounded-xl border p-4 text-sm",
          short ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900",
        )}
      >
        <span className="font-semibold">{short ? "Short of target. " : over ? "Over target. " : "On target. "}</span>
        {verdict}
        {s.leadsLeft > 0 && s.daysOfDemand != null && (
          <span>
            {" "}
            Active clients have paid for about {num(s.leadsLeft)} more leads, which is {num(s.daysOfDemand)} days at the target pace.
          </span>
        )}
      </div>

      <Panel
        title="By client"
        note={`Leads delivered each day, most starved first. Budget left is each client's unspent ad budget; leads left is what that and any open order still cover. The average covers ${span}; today is a part day and is not in it. Green is ${data.target} or more, red is under ${data.floor}.`}
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[150px]">Client</TableHead>
                {data.days.map((d) => (
                  <TableHead key={d} className={cn("text-right", data.avgWindow.includes(d) ? "text-slate-900" : "text-slate-400")}>
                    <div>{weekday(d)}</div>
                    <div className="text-[10px] font-normal">{shortDate(d)}</div>
                  </TableHead>
                ))}
                <TableHead className="text-right">Today</TableHead>
                <TableHead className="text-right">Avg a day</TableHead>
                <TableHead>Pace</TableHead>
                <TableHead className="text-right">Budget left</TableHead>
                <TableHead className="text-right">Leads left</TableHead>
                <TableHead className="min-w-[120px]">Lead types</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.map((r) => (
                <TableRow key={r.userId}>
                  <TableCell className="font-medium">
                    {r.name}
                    {r.note && <div className="text-[11px] font-normal text-slate-500">{r.note}</div>}
                  </TableCell>
                  {r.perDay.map((n, i) => (
                    <DayCell key={data.days[i]} n={n} target={data.target} floor={data.floor} muted={!data.avgWindow.includes(data.days[i])} />
                  ))}
                  <TableCell className="text-right tabular-nums text-slate-500">{r.today || "·"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{r.avgPerDay.toFixed(1)}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.budgetLeftCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.leadsLeft == null ? "—" : num(r.leadsLeft)}</TableCell>
                  <TableCell className="text-xs text-slate-500">{typesOf(r)}</TableCell>
                </TableRow>
              ))}
              {!active.length && (
                <TableRow>
                  <TableCell colSpan={data.days.length + 7} className="py-6 text-center text-sm text-slate-500">
                    No active clients.
                  </TableCell>
                </TableRow>
              )}
              <TableRow className="bg-slate-50">
                <TableCell className="font-medium">
                  House turn
                  <div className="text-[11px] font-normal text-slate-500">Not a client</div>
                </TableCell>
                {data.house.perDay.map((n, i) => (
                  <TableCell key={data.days[i]} className="text-right tabular-nums text-slate-500">{n || "·"}</TableCell>
                ))}
                <TableCell className="text-right tabular-nums text-slate-500">{data.house.today || "·"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{data.house.avgPerDay.toFixed(1)}</TableCell>
                <TableCell colSpan={4} />
              </TableRow>
              {inactive.map((r) => (
                <TableRow key={r.userId} className="text-slate-400">
                  <TableCell>
                    {r.name}
                    {r.note && <div className="text-[11px]">{r.note}</div>}
                  </TableCell>
                  {r.perDay.map((n, i) => (
                    <TableCell key={data.days[i]} className="text-right tabular-nums">{n || "·"}</TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{r.today || "·"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.avgPerDay.toFixed(1)}</TableCell>
                  <TableCell><StatusPill status={r.status} /></TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.budgetLeftCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.leadsLeft == null ? "—" : num(r.leadsLeft)}</TableCell>
                  <TableCell className="text-xs">{typesOf(r)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <LeadsByClientPanel />

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel title="By day" note="What went out each day and what it cost. Cost per lead is that day's ad spend over the leads our campaigns brought in.">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Delivered</TableHead>
                    <TableHead className="text-right">To clients</TableHead>
                    <TableHead className="text-right">House turn</TableHead>
                    <TableHead className="text-right">Clients served</TableHead>
                    <TableHead className="text-right">Per served client</TableHead>
                    <TableHead className="text-right">Ad spend</TableHead>
                    <TableHead className="text-right">Cost per lead</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.byDay.map((d) => (
                    <TableRow key={d.day} className={cn(!data.avgWindow.includes(d.day) && "text-slate-400")}>
                      <TableCell className="whitespace-nowrap font-medium">{weekday(d.day)} {shortDate(d.day)}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.delivered}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.toClients}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.toHouse}</TableCell>
                      <TableCell className="text-right tabular-nums">{d.clientsServed}</TableCell>
                      <TableCell className="text-right tabular-nums">{num(d.perServedClient)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(d.spendCents)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(d.costPerLeadCents)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-slate-50 text-slate-500">
                    <TableCell className="whitespace-nowrap font-medium">Today so far</TableCell>
                    <TableCell className="text-right tabular-nums">{s.todayToClients + s.todayToHouse}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.todayToClients}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.todayToHouse}</TableCell>
                    <TableCell colSpan={4} />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Panel>
        </div>

        <Panel title="By lead type" note={`Leads a day to clients, ${span}, against the active clients with that type switched on.`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Clients</TableHead>
                <TableHead className="text-right">Leads a day</TableHead>
                <TableHead className="text-right">Per client</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {([["Blue Collar", s.blueCollar], ["Nurse", s.nurse]] as const).map(([label, t]) => (
                <TableRow key={label}>
                  <TableCell className="font-medium">{label}</TableCell>
                  <TableCell className="text-right tabular-nums">{t.activeClients}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(t.leadsPerDay)}</TableCell>
                  <TableCell className="text-right tabular-nums">{num(t.perClient)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-slate-500">
            A client with both types on counts under each, so these do not add up to the per-client figure above.
          </p>
        </Panel>
      </div>

      {data.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {data.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
    </div>
  );
}
