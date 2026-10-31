"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, ArrowDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, cn } from "@/lib/utils";

type Funnel = "ABCA" | "Enhanced Wealth" | "HWA" | "Other";
interface Row {
  adId: string;
  adName: string;
  detail: string;
  status: string | null;
  funnel: Funnel;
  spendCents: number;
  leads: number;
  apps: number;
  paid: number;
  premiumCents: number;
  cplCents: number | null;
  costPerPaidCents: number | null;
  appRatePct: number | null;
  premiumPerDollar: number | null;
}
interface Data {
  configured: boolean;
  errors: string[];
  days: number | "all";
  since: string | null;
  until: string;
  rows: Row[];
  noAdLeads: number;
}

const RANGES: { value: string; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
];
const FUNNELS: ("All" | Funnel)[] = ["All", "ABCA", "Enhanced Wealth", "HWA"];
const FUNNEL_STYLE: Record<Funnel, string> = {
  ABCA: "bg-blue-50 text-blue-700",
  "Enhanced Wealth": "bg-emerald-50 text-emerald-700",
  HWA: "bg-teal-50 text-teal-700",
  Other: "bg-slate-100 text-slate-600",
};

type SortKey = "spendCents" | "leads" | "cplCents" | "apps" | "appRatePct" | "paid" | "premiumCents" | "costPerPaidCents" | "premiumPerDollar";
const COLUMNS: { key: SortKey; label: string; title?: string }[] = [
  { key: "spendCents", label: "Spend" },
  { key: "leads", label: "Leads" },
  { key: "cplCents", label: "Cost/lead" },
  { key: "apps", label: "Apps", title: "Leads now in Underwriting, Approved, Issued not paid or Issued PAID" },
  { key: "appRatePct", label: "Lead → app" },
  { key: "paid", label: "Issued PAID" },
  { key: "premiumCents", label: "Premium", title: "Annual premium on Issued PAID deals" },
  { key: "costPerPaidCents", label: "Cost/paid deal" },
  { key: "premiumPerDollar", label: "Premium per $1", title: "Annual premium written for every $1 of ad spend" },
];
// Lower is better for cost columns, so they sort ascending.
const ASCENDING: Set<SortKey> = new Set(["cplCents", "costPerPaidCents"]);

const money = (c: number | null) => (c == null ? "—" : formatCurrency(c / 100));

/** Admin: every ad ranked by what its leads became in the CRM, not just what they cost. */
export function CreativeScorecard() {
  const [range, setRange] = useState("30");
  const [funnel, setFunnel] = useState<"All" | Funnel>("All");
  const [sort, setSort] = useState<SortKey>("paid");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/admin/creative-scorecard?days=${range}`)
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [range]);

  const rows = useMemo(() => {
    if (!data?.rows) return [];
    const asc = ASCENDING.has(sort);
    return data.rows
      .filter((r) => funnel === "All" || r.funnel === funnel)
      .sort((a, b) => {
        const av = a[sort], bv = b[sort];
        // Rows with no value (e.g. no paid deals yet) always sink to the bottom.
        if (av == null && bv == null) return b.spendCents - a.spendCents;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return asc ? av - bv : bv - av;
        // Tie-break on the next most meaningful signals.
        return b.premiumCents - a.premiumCents || b.apps - a.apps || b.spendCents - a.spendCents;
      });
  }, [data, funnel, sort]);

  const totals = useMemo(() => {
    const t = rows.reduce(
      (s, r) => ({
        spendCents: s.spendCents + r.spendCents,
        leads: s.leads + r.leads,
        apps: s.apps + r.apps,
        paid: s.paid + r.paid,
        premiumCents: s.premiumCents + r.premiumCents,
      }),
      { spendCents: 0, leads: 0, apps: 0, paid: 0, premiumCents: 0 },
    );
    return {
      ...t,
      cplCents: t.leads > 0 && t.spendCents > 0 ? Math.round(t.spendCents / t.leads) : null,
      appRatePct: t.leads > 0 ? Math.round((t.apps / t.leads) * 1000) / 10 : null,
      costPerPaidCents: t.paid > 0 && t.spendCents > 0 ? Math.round(t.spendCents / t.paid) : null,
      premiumPerDollar: t.spendCents > 0 ? Math.round((t.premiumCents / t.spendCents) * 100) / 100 : null,
    };
  }, [rows]);

  const cell = (r: Pick<Row, SortKey>, key: SortKey) => {
    const v = r[key];
    if (key === "spendCents" || key === "cplCents" || key === "premiumCents" || key === "costPerPaidCents") return money(v);
    if (key === "appRatePct") return v == null ? "—" : `${v}%`;
    if (key === "premiumPerDollar") return v == null ? "—" : `$${v.toFixed(2)}`;
    return v ?? "—";
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex flex-wrap rounded-md border border-slate-200 p-0.5">
          {FUNNELS.map((f) => (
            <button
              key={f}
              onClick={() => setFunnel(f)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                funnel === f ? "bg-slate-900 text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-md border border-slate-200 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                range === r.value ? "bg-brand-red text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted-foreground max-w-3xl">
        Leads are counted by the day they came in; apps, Issued PAID and premium show how far <em>those</em> leads have
        gone in the CRM so far, so recent windows fill in as deals close. Click a column to rank by it.
      </p>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading scorecard…
        </div>
      ) : !data || !Array.isArray(data.rows) ? (
        <div className="py-8 text-center text-sm text-rose-600">Couldn&apos;t load the scorecard.</div>
      ) : (
        <>
          {!data.configured && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Meta isn&apos;t connected (needs META_ADS_ACCESS_TOKEN on the server), so spend and ad names are missing.
              Lead and deal counts below are still accurate.
            </div>
          )}
          {data.errors?.length > 0 && (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              Meta error: {data.errors.join(" · ")}
            </div>
          )}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ad</TableHead>
                  {COLUMNS.map((c) => (
                    <TableHead key={c.key} className="text-right whitespace-nowrap">
                      <button
                        onClick={() => setSort(c.key)}
                        title={c.title}
                        className={cn(
                          "inline-flex items-center gap-0.5 hover:text-foreground",
                          sort === c.key && "font-semibold text-foreground",
                        )}
                      >
                        {c.label}
                        {sort === c.key && <ArrowDown className={cn("h-3 w-3", ASCENDING.has(c.key) && "rotate-180")} />}
                      </button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length + 1} className="py-8 text-center text-sm text-muted-foreground">
                      No ad spend or ad leads in this window.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.adId}>
                    <TableCell className="min-w-[240px]">
                      <div className="text-sm font-medium">{r.adName}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className={cn("rounded px-1 py-px text-[10px] font-medium", FUNNEL_STYLE[r.funnel])}>{r.funnel}</span>
                        {r.status && r.status !== "ACTIVE" && (
                          <span className="rounded bg-slate-100 px-1 py-px text-[10px] uppercase">
                            {r.status.replace(/_/g, " ").toLowerCase()}
                          </span>
                        )}
                        <span className="truncate max-w-[320px]">{r.detail}</span>
                      </div>
                    </TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          "text-right tabular-nums",
                          (c.key === "paid" || c.key === "premiumCents") && r[c.key] ? "font-semibold text-emerald-700" : "",
                          sort === c.key && "bg-slate-50",
                        )}
                      >
                        {cell(r, c.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {rows.length > 0 && (
                  <TableRow className="bg-slate-50 font-semibold">
                    <TableCell>
                      Total {data.since ? `(${data.since} → ${data.until})` : "(all time)"}
                    </TableCell>
                    {COLUMNS.map((c) => (
                      <TableCell key={c.key} className="text-right tabular-nums">
                        {cell(totals, c.key)}
                      </TableCell>
                    ))}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          {data.noAdLeads > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {data.noAdLeads} lead{data.noAdLeads === 1 ? "" : "s"} in this window have no ad recorded (imports, manual
              entries or older leads), so they aren&apos;t in a row.
            </p>
          )}
        </>
      )}
    </div>
  );
}
