"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, cn } from "@/lib/utils";

interface Row {
  adId: string;
  adName: string;
  adsetName: string;
  status: string | null;
  spendCents: number;
  landingPageViews: number;
  metaLeads: number;
  realLeads: number;
  realCplCents: number | null;
  metaCplCents: number | null;
  realConversionPct: number | null;
}
interface Data {
  configured: boolean;
  error: string | null;
  days: number;
  since: string;
  until: string;
  rows: Row[];
  totals: { spendCents: number; metaLeads: number; realLeads: number; realCplCents: number | null; metaCplCents: number | null };
  unmatchedLeads: number;
}

const RANGES = [
  { days: 1, label: "Today" },
  { days: 3, label: "3 days" },
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
];
const money = (c: number | null) => (c == null ? "—" : formatCurrency(c / 100));

/** Admin: real cost per lead by ad (Meta spend ÷ leads that actually reached us), next to Meta's own count. */
export function AdCostTable() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetch(`/api/admin/ad-costs?days=${days}`)
      .then((r) => r.json())
      .then((d) => live && setData(d))
      .catch(() => live && setData(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground max-w-2xl">
          <span className="font-medium text-foreground">Real cost/lead</span> = spend ÷ leads that actually reached your system.
          Meta&apos;s own count includes people who only <em>saw</em> an ad and conversions from your other funnel on the shared
          pixel, so it usually reads lower. Days are US Central, like the ad account.
        </p>
        <div className="inline-flex rounded-md border border-slate-200 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium",
                days === r.days ? "bg-brand-red text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading ad costs…
        </div>
      ) : !data ? (
        <div className="py-8 text-center text-sm text-rose-600">Couldn&apos;t load ad costs.</div>
      ) : !data.configured ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Meta isn&apos;t connected for this ad account yet (needs META_ADS_ACCESS_TOKEN and ABCA_AD_ACCOUNT_ID on the server).
        </div>
      ) : data.error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">Meta error: {data.error}</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Page visits</TableHead>
                <TableHead className="text-right">Real leads</TableHead>
                <TableHead className="text-right">Real cost/lead</TableHead>
                <TableHead className="text-right">Visit → lead</TableHead>
                <TableHead className="text-right text-muted-foreground">Meta says</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                    No ad spend in this window.
                  </TableCell>
                </TableRow>
              )}
              {data.rows.map((r) => (
                <TableRow key={r.adId}>
                  <TableCell className="min-w-[220px]">
                    <div className="text-sm font-medium">{r.adName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {r.adsetName}
                      {r.status && r.status !== "ACTIVE" && (
                        <span className="ml-1.5 rounded bg-slate-100 px-1 py-px text-[10px] uppercase">{r.status.replace(/_/g, " ").toLowerCase()}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(r.spendCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.landingPageViews}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{r.realLeads}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{money(r.realCplCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.realConversionPct == null ? "—" : `${r.realConversionPct}%`}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {r.metaLeads} @ {money(r.metaCplCents)}
                  </TableCell>
                </TableRow>
              ))}
              {data.rows.length > 0 && (
                <TableRow className="bg-slate-50 font-semibold">
                  <TableCell>Total ({data.since === data.until ? data.since : `${data.since} → ${data.until}`})</TableCell>
                  <TableCell className="text-right tabular-nums">{money(data.totals.spendCents)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{data.totals.realLeads}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(data.totals.realCplCents)}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                    {data.totals.metaLeads} @ {money(data.totals.metaCplCents)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {data.unmatchedLeads > 0 && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {data.unmatchedLeads} lead{data.unmatchedLeads === 1 ? "" : "s"} in this window came from an ad with no spend in
              the window, or without an ad id, so they aren&apos;t in a row.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
