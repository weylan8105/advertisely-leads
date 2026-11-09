"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronRight, Loader2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/layout/PageHeader";
import { Pills } from "@/components/activity/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { AdPerformance, PerfDay, PerfDealRow, PerfRange, PerfSummary } from "@/lib/adPerformance";

const REFRESH_MS = 60_000;

const RANGES: { id: PerfRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "shared", label: "Since Sep 14" },
];
type FunnelView = "all" | "ew" | "abca";
const FUNNELS: { id: FunnelView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "ew", label: "Enhanced Wealth" },
  { id: "abca", label: "ABCA" },
];
const FUNNEL_NAME = { ew: "Enhanced Wealth", abca: "ABCA" } as const;
const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Paused",
  CAMPAIGN_PAUSED: "Paused",
  ADSET_PAUSED: "Paused",
  ARCHIVED: "Archived",
  WITH_ISSUES: "Has issues",
  PENDING_REVIEW: "In review",
};

const money = (cents: number | null | undefined) => {
  if (cents == null) return "—";
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Math.abs(dollars) >= 1000 ? 0 : 2,
  });
};
const count = (n: number) => n.toLocaleString("en-US");
// Short windows can show more dials than new leads, so only show a share that makes sense.
const share = (part: number, whole: number, of: string) =>
  whole > 0 && part <= whole ? `${Math.round((part / whole) * 100)}% of ${of}` : undefined;
const shortDate = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div
      className={cn(
        "flex min-h-[124px] flex-col rounded-xl p-5",
        strong ? "bg-slate-900 text-white" : "border border-slate-200 bg-white",
      )}
    >
      <div className={cn("text-[11px] font-semibold uppercase tracking-[0.16em]", strong ? "text-white/60" : "text-slate-500")}>
        {label}
      </div>
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

function DayTooltip({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((n: number, p: any) => n + (p.value ?? 0), 0);
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-medium">{shortDate(label)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.fill }} />
            {FUNNEL_NAME[p.dataKey as "ew" | "abca"]}
          </span>
          <span className="tabular-nums">{format(p.value ?? 0)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1 flex justify-between gap-4 border-t border-slate-200 pt-1 font-medium">
          <span>Total</span>
          <span className="tabular-nums">{format(total)}</span>
        </div>
      )}
    </div>
  );
}

function DayChart({
  title,
  days,
  metric,
  view,
  format,
}: {
  title: string;
  days: PerfDay[];
  metric: "spendCents" | "leads" | "applications";
  view: FunnelView;
  format: (n: number) => string;
}) {
  const data = days.map((d) => ({ date: d.date, ew: d.ew[metric], abca: d.abca[metric] }));
  const showEw = view !== "abca";
  const showAbca = view !== "ew";
  const axis = { fontSize: 11, fill: "hsl(var(--muted-foreground))" };
  return (
    <div className="min-w-0">
      <div className="mb-2 text-xs font-medium text-slate-500">{title}</div>
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="2 4" />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={axis} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis
              tick={axis}
              tickLine={false}
              axisLine={false}
              width={metric === "spendCents" ? 48 : 28}
              allowDecimals={false}
              tickFormatter={metric === "spendCents" ? (v) => `$${Math.round(v / 100)}` : undefined}
            />
            <Tooltip cursor={{ fill: "hsl(var(--muted))" }} content={<DayTooltip format={format} />} />
            {showEw && (
              <Bar
                dataKey="ew"
                stackId="day"
                fill="var(--series-ew)"
                stroke="hsl(var(--card))"
                strokeWidth={1}
                radius={showAbca ? 0 : [4, 4, 0, 0]}
                isAnimationActive={false}
              />
            )}
            {showAbca && (
              <Bar dataKey="abca" stackId="day" fill="var(--series-abca)" stroke="hsl(var(--card))" strokeWidth={1} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const COMPARE_ROWS: { label: string; value: (s: PerfSummary) => string }[] = [
  { label: "Ad spend", value: (s) => (s.spendKnown ? money(s.spendCents) : "—") },
  { label: "New leads", value: (s) => count(s.leads) },
  { label: "Dials", value: (s) => count(s.dials) },
  { label: "Contacted", value: (s) => count(s.contacted) },
  { label: "Dials per contact", value: (s) => s.dialsPerContact?.toFixed(1) ?? "—" },
  { label: "Applications", value: (s) => count(s.applications) },
  { label: "Issued PAID", value: (s) => count(s.issuedPaid) },
  { label: "Premium", value: (s) => money(s.premiumCents) },
  { label: "Cost per lead", value: (s) => money(s.cplCents) },
  { label: "CPA", value: (s) => money(s.cpaCents) },
  { label: "CAC", value: (s) => money(s.cacCents) },
];

/** Admin: how the ads are running, with Meta's numbers next to what the leads became. */
export function AdPerformanceDashboard() {
  const [range, setRange] = useState<PerfRange>("30d");
  const [view, setView] = useState<FunnelView>("all");
  const [data, setData] = useState<AdPerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const res = await fetch(`/api/admin/performance?range=${range}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const next: AdPerformance = await res.json();
      if (request !== latest.current) return;
      setData(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    } finally {
      if (request === latest.current) setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keeps "updated 12s ago" honest between refreshes.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, []);

  const s = data?.funnels[view];
  const secondsAgo = data ? Math.max(0, Math.round((now - new Date(data.fetchedAt).getTime()) / 1000)) : null;
  const campaigns = (data?.campaigns ?? []).filter((c) => view === "all" || c.funnel === view);
  const showPixels = !!data?.events.some((e) => e.shown != null);
  const deals = data?.deals ?? [];
  const dealTotal = (key: Exclude<keyof PerfDealRow, "agent">) => deals.reduce((n, d) => n + d[key], 0);

  return (
    <div className="[--series-abca:#eb6834] [--series-ew:#2a78d6] dark:[--series-abca:#d95926] dark:[--series-ew:#3987e5]">
      <PageHeader
        eyebrow="Internal · Advertisely Admin"
        title="Ad Performance"
        description="What Meta spent and what those leads became in Advertisely, on one page."
        className="mb-5"
        actions={
          <div className="flex items-center gap-2 text-xs text-slate-500" role="status">
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <span className={cn("h-2 w-2 rounded-full", failed ? "bg-amber-500" : "bg-emerald-500")} />
            )}
            {failed
              ? `Couldn't refresh${secondsAgo != null ? `, showing data from ${secondsAgo}s ago` : ""}`
              : secondsAgo != null
                ? `Updated ${secondsAgo}s ago · refreshes every minute`
                : "Loading"}
          </div>
        }
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Pills value={range} onChange={setRange} options={RANGES} />
        <Pills value={view} onChange={setView} options={FUNNELS} />
      </div>

      {data && !data.metaConfigured && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Meta isn&apos;t connected, so spend and costs are blank. Set META_ADS_ACCESS_TOKEN or META_ADS_MANAGE_TOKEN in Vercel.
        </div>
      )}
      {data?.metaConfigured && !!data.errors.length && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" title={data.errors[0]}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {data.missing.length
            ? `Meta didn't return spend for ${data.missing.map((f) => FUNNEL_NAME[f]).join(" and ")}, so its costs are blank until the app has access to that ad account.`
            : "Meta didn't return everything, so the trends may be incomplete."}
        </div>
      )}

      {!s ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
          {failed ? "Couldn't load the dashboard." : "Loading the numbers…"}
        </div>
      ) : (
        <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile
              label="Ad spend"
              value={s.spendKnown ? money(s.spendCents) : "—"}
              hint={s.spendKnown ? (s.activeBudgetCents > 0 ? `${money(s.activeBudgetCents)} a day in active budgets` : "No active budgets") : "Spend not available"}
            />
            <Tile label="Cost per lead" value={money(s.cplCents)} hint={`${count(s.leads)} new leads`} />
            <Tile label="CPA · cost per application" value={money(s.cpaCents)} hint={`${count(s.applications)} applications`} strong />
            <Tile
              label="CAC · cost per Issued PAID"
              value={money(s.cacCents)}
              hint={`${count(s.issuedPaid)} Issued PAID · ${money(s.premiumCents)} premium`}
              strong
            />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="New leads" value={count(s.leads)} />
            <Tile label="Dials" value={count(s.dials)} hint={`${count(s.leadsDialed)} leads dialed`} />
            <Tile label="Contacted" value={count(s.contacted)} hint={share(s.contacted, s.dials, "dials")} />
            <Tile
              label="Dials per contact"
              value={s.dialsPerContact?.toFixed(1) ?? "—"}
              hint={s.reached > 0 ? `Across ${count(s.reached)} contacts` : "Measured from Nov 6"}
            />
            <Tile label="Applications" value={count(s.applications)} hint={share(s.applications, s.contacted, "contacted")} />
            <Tile label="Issued PAID" value={count(s.issuedPaid)} hint={share(s.issuedPaid, s.applications, "applications")} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <Panel title="Enhanced Wealth vs ABCA">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead />
                        <TableHead className="text-right">Enhanced Wealth</TableHead>
                        <TableHead className="text-right">ABCA</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {COMPARE_ROWS.map((r) => (
                        <TableRow key={r.label}>
                          <TableCell className="py-1.5 text-slate-500">{r.label}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{r.value(data!.funnels.ew)}</TableCell>
                          <TableCell className="py-1.5 text-right tabular-nums">{r.value(data!.funnels.abca)}</TableCell>
                          <TableCell className="py-1.5 text-right font-medium tabular-nums">{r.value(data!.funnels.all)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            </div>
            <Panel title="What Meta sees" note={view === "all" ? "Both ad accounts" : FUNNEL_NAME[view]}>
              <dl className="space-y-2.5 text-sm">
                {[
                  ["Impressions", count(s.impressions)],
                  ["Link clicks", count(s.linkClicks)],
                  ["Click-through rate", s.ctrPct == null ? "—" : `${s.ctrPct.toFixed(2)}%`],
                  ["Cost per 1,000 impressions", money(s.cpmCents)],
                  ["Leads, per Meta", count(s.metaLeads)],
                  ["Leads, in Advertisely", count(s.leads)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-3">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          </div>

          <Panel title="Last 14 days">
            <div className="mb-3 flex gap-4 text-xs text-slate-500">
              {view !== "abca" && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[var(--series-ew)]" /> Enhanced Wealth
                </span>
              )}
              {view !== "ew" && (
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm bg-[var(--series-abca)]" /> ABCA
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
              <DayChart title="Ad spend" days={data!.daily} metric="spendCents" view={view} format={money} />
              <DayChart title="New leads" days={data!.daily} metric="leads" view={view} format={count} />
              <DayChart title="Applications" days={data!.daily} metric="applications" view={view} format={count} />
            </div>
            <details className="mt-3 text-xs text-slate-500">
              <summary className="cursor-pointer">See the daily numbers</summary>
              <div className="mt-2 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">New leads</TableHead>
                      <TableHead className="text-right">Applications</TableHead>
                      <TableHead className="text-right">Issued PAID</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...data!.daily].reverse().map((d) => {
                      const sum = (k: "spendCents" | "leads" | "applications" | "issuedPaid") =>
                        (view !== "abca" ? d.ew[k] : 0) + (view !== "ew" ? d.abca[k] : 0);
                      return (
                        <TableRow key={d.date}>
                          <TableCell className="py-1">{shortDate(d.date)}</TableCell>
                          <TableCell className="py-1 text-right tabular-nums">{money(sum("spendCents"))}</TableCell>
                          <TableCell className="py-1 text-right tabular-nums">{sum("leads")}</TableCell>
                          <TableCell className="py-1 text-right tabular-nums">{sum("applications")}</TableCell>
                          <TableCell className="py-1 text-right tabular-nums">{sum("issuedPaid")}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </details>
          </Panel>

          <Panel
            title="Deals by agent"
            note="All time, every funnel: the date and funnel buttons don't change this table. The stage columns are the same counts as Client Accounts."
          >
            {deals.length === 0 ? (
              <p className="text-sm text-slate-500">No applications yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-right">Underwriting</TableHead>
                      <TableHead className="text-right">Approved</TableHead>
                      <TableHead className="text-right">Issued Not Paid</TableHead>
                      <TableHead className="text-right">Issued PAID</TableHead>
                      <TableHead className="text-right" title="Got an application in, then was declined or moved back">Left those stages</TableHead>
                      <TableHead className="text-right">Applications</TableHead>
                      <TableHead className="text-right">Premium</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deals.map((d) => (
                      <TableRow key={d.agent}>
                        <TableCell className="py-1.5 font-medium">{d.agent}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{count(d.underwriting)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{count(d.approved)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{count(d.issuedNotPaid)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{count(d.issuedPaid)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{count(d.leftStages)}</TableCell>
                        <TableCell className="py-1.5 text-right font-medium tabular-nums">{count(d.applications)}</TableCell>
                        <TableCell className="py-1.5 text-right tabular-nums">{money(d.premiumCents)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-semibold">
                      <TableCell className="py-1.5">Total</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(dealTotal("underwriting"))}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(dealTotal("approved"))}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(dealTotal("issuedNotPaid"))}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(dealTotal("issuedPaid"))}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(dealTotal("leftStages"))}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(dealTotal("applications"))}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{money(dealTotal("premiumCents"))}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>

          <Panel title="Campaigns">
            {campaigns.length === 0 ? (
              <p className="text-sm text-slate-500">No campaigns ran in this window.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Daily budget</TableHead>
                      <TableHead className="text-right">Spend</TableHead>
                      <TableHead className="text-right">Leads</TableHead>
                      <TableHead className="text-right">Applications</TableHead>
                      <TableHead className="text-right">Issued PAID</TableHead>
                      <TableHead className="text-right">CPA</TableHead>
                      <TableHead className="text-right">CAC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => (
                      <TableRow key={c.campaignId}>
                        <TableCell className="max-w-[280px]">
                          <div className="truncate font-medium" title={c.name}>{c.name}</div>
                          <div className="text-xs text-slate-500">{FUNNEL_NAME[c.funnel]}</div>
                        </TableCell>
                        <TableCell>{STATUS_LABEL[c.status ?? ""] ?? c.status ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.dailyBudgetCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.spendCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(c.leads)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(c.applications)}</TableCell>
                        <TableCell className="text-right tabular-nums">{count(c.issuedPaid)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.cpaCents)}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(c.cacCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {view === "all" && data!.noCampaign.leads + data!.noCampaign.applications > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {count(data!.noCampaign.leads)} leads and {count(data!.noCampaign.applications)} applications aren&apos;t in this table because{" "}
                {data!.missing.length
                  ? `Meta isn't sharing ${data!.missing.map((f) => FUNNEL_NAME[f]).join(" and ")} campaigns, or no campaign was recorded.`
                  : "no campaign was recorded."}
              </p>
            )}
          </Panel>

          <Panel
            title="Events sent to Meta"
            note={`${
              showPixels
                ? "What Advertisely sent in this window next to what the pixels show. Resent events count on the day they happened, so the two can differ."
                : "What Advertisely sent in this window."
            } This log only goes back to Nov 4 and includes resends, so it isn't a count of deals.`}
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Stage</TableHead>
                    <TableHead>Meta event</TableHead>
                    <TableHead className="text-right">Sent</TableHead>
                    <TableHead className="text-right">Refused</TableHead>
                    {showPixels && <TableHead className="text-right">On the pixels</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data!.events.map((e) => (
                    <TableRow key={e.stage}>
                      <TableCell className="py-1.5">{e.stage}</TableCell>
                      <TableCell className="py-1.5 text-slate-500">{e.event}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(e.sent)}</TableCell>
                      <TableCell className="py-1.5 text-right tabular-nums">{count(e.failed)}</TableCell>
                      {showPixels && <TableCell className="py-1.5 text-right tabular-nums">{e.shown == null ? "—" : count(e.shown)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Panel>

          <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs text-slate-500">
            <summary className="flex cursor-pointer items-center gap-1 font-medium">
              <ChevronRight className="h-3.5 w-3.5" /> How these numbers work
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Application: a lead that reached Underwriting, Approved, Issued Not Paid or Issued PAID. It counts once, on the first day it got there, and a later decline doesn&apos;t remove it.</li>
              <li>CPA is ad spend divided by applications. CAC is ad spend divided by Issued PAID.</li>
              <li>Everything counts on the day it happened, so a sale today can come from an older lead. Short windows swing a lot; use 30 days or longer to judge CAC.</li>
              <li>The tiles only count what happened in the dates you pick. Client Accounts shows every deal ever, by its stage now. Deals by agent shows that same all-time view, so use it to check the two against each other.</li>
              <li>A dial is logged each time someone copies a lead&apos;s number, taps Call or clicks the lead. Clicking the lead and then copying its number is one dial, and so is clicking it again within 30 minutes. Copying the number or tapping Call again counts as another dial, up to 2 dials per lead in any 2 minutes.</li>
              <li>Dials weren&apos;t logged before Nov 6, so those days show one dial per lead moved out of New Lead, and their contact rate reads high.</li>
              <li>Contacted means a lead reached Contacted or further. Dials per contact is the average number of dials a lead took before that, for leads first worked since Nov 6.</li>
              <li>Days run on Central time in Advertisely. Meta uses each ad account&apos;s own timezone: Pacific for Enhanced Wealth, Central for ABCA.</li>
              <li>Client campaigns and their leads aren&apos;t included. Leads moved to the trash aren&apos;t counted either, so Advertisely can read a little below Meta.</li>
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
