"use client";

import { useEffect, useState } from "react";
import { TrendingUp, DollarSign, Wallet, RotateCcw, Trophy, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";

interface PnL {
  summary: {
    netCents: number;
    commissionCents: number;
    costCents: number;
    buybackCents: number;
    policiesSold: number;
    delivered: number;
    apCents: number;
    roi: number | null;
  };
  funnel: { delivered: number; worked: number; quoted: number; closed: number };
  byLeadType: {
    market: string;
    delivered: number;
    closed: number;
    apCents: number;
    commissionCents: number;
    costCents: number;
    netCents: number;
    roi: number | null;
  }[];
  campaigns: {
    id: string;
    name: string;
    delivered: number;
    closed: number;
    apCents: number;
    costCents: number;
    netCents: number;
    roi: number | null;
  }[];
}

const money = (cents: number) => formatCurrency(Math.round(cents) / 100);
const roiLabel = (roi: number | null) => (roi == null ? "—" : `${roi.toFixed(1)}×`);

export default function PnLPage() {
  const [data, setData] = useState<PnL | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/pnl")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 justify-center py-24 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Crunching your numbers…
      </div>
    );
  }
  if (error || !data) {
    return <div className="text-rose-600 py-24 text-center">Couldn&apos;t load your P&amp;L: {error}</div>;
  }

  const { summary: s, funnel: f, byLeadType, campaigns } = data;
  const pct = (n: number) => (f.delivered > 0 ? Math.round((n / f.delivered) * 100) : 0);

  const stat = (
    label: string,
    value: string,
    hint: string,
    icon: React.ReactNode,
    accent: string,
  ) => (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="text-[11px] font-semibold tracking-wide uppercase text-muted-foreground">{label}</div>
        <div className={cn("h-9 w-9 grid place-items-center rounded-lg", accent)}>{icon}</div>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Card>
  );

  const funnelRows = [
    { label: "Leads delivered", n: f.delivered, tone: "bg-blue-600" },
    { label: "Worked / contacted", n: f.worked, tone: "bg-blue-500" },
    { label: "Quoted", n: f.quoted, tone: "bg-indigo-500" },
    { label: "Closed / sold", n: f.closed, tone: "bg-emerald-500" },
  ];

  return (
    <div className="max-w-5xl space-y-8">
      <PageHeader
        eyebrow="Your business"
        title="Profit & Loss"
        description="Every lead, every close, every dollar — in one place. Log a sale by dragging a lead to Issued PAID in your pipeline."
      />

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stat(
          "Net profit",
          money(s.netCents),
          s.roi != null ? `${s.roi.toFixed(1)}× return on lead spend` : `after ${money(s.costCents)} lead spend`,
          <TrendingUp className="h-4 w-4 text-emerald-600" />,
          "bg-emerald-500/15",
        )}
        {stat(
          "Commission earned",
          money(s.commissionCents),
          `${money(s.apCents)} annual premium written`,
          <DollarSign className="h-4 w-4 text-emerald-600" />,
          "bg-emerald-500/15",
        )}
        {stat(
          "Lead spend",
          money(s.costCents),
          "across all lead orders",
          <Wallet className="h-4 w-4 text-blue-600" />,
          "bg-blue-500/15",
        )}
        {stat(
          "Buyback credit",
          money(s.buybackCents),
          "recovered on replaced leads",
          <RotateCcw className="h-4 w-4 text-blue-600" />,
          "bg-blue-500/15",
        )}
      </div>

      {/* Funnel */}
      <Card className="p-6">
        <h2 className="font-semibold tracking-tight">Your funnel</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Based on the stages you move leads through in your pipeline.</p>
        <div className="mt-5 space-y-3">
          {funnelRows.map((row) => (
            <div key={row.label} className="flex items-center gap-3">
              <div className="w-36 text-sm text-muted-foreground shrink-0">{row.label}</div>
              <div className="flex-1 h-7 rounded-md bg-slate-100 overflow-hidden relative">
                <div
                  className={cn("h-full rounded-md flex items-center justify-end pr-2 text-white text-xs font-semibold", row.tone)}
                  style={{ width: `${Math.max(pct(row.n), row.n > 0 ? 6 : 0)}%` }}
                >
                  {row.n > 0 ? row.n : ""}
                </div>
              </div>
              <div className="w-12 text-right text-sm text-muted-foreground">{pct(row.n)}%</div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Close rate: <span className="font-medium text-foreground">{pct(f.closed)}%</span> of delivered leads ·{" "}
          {s.policiesSold} {s.policiesSold === 1 ? "policy" : "policies"} logged
        </p>
      </Card>

      {/* By lead type */}
      <Card className="p-6">
        <h2 className="font-semibold tracking-tight">By lead type</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Where your money actually comes from.</p>
        <div className="mt-4 overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-slate-200">
                <th className="text-left py-2 font-medium">Market</th>
                <th className="text-right py-2 font-medium">Delivered</th>
                <th className="text-right py-2 font-medium">Closed</th>
                <th className="text-right py-2 font-medium">AP</th>
                <th className="text-right py-2 font-medium">Commission</th>
                <th className="text-right py-2 font-medium">Cost</th>
                <th className="text-right py-2 font-medium">Net</th>
                <th className="text-right py-2 font-medium">ROI</th>
              </tr>
            </thead>
            <tbody>
              {byLeadType.map((r) => (
                <tr key={r.market} className="border-b border-slate-100">
                  <td className="py-2.5 font-medium">{r.market}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.delivered}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.closed}</td>
                  <td className="py-2.5 text-right tabular-nums">{money(r.apCents)}</td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-600">{money(r.commissionCents)}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{money(r.costCents)}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">{money(r.netCents)}</td>
                  <td className="py-2.5 text-right tabular-nums">{roiLabel(r.roi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* By campaign */}
      <Card className="p-6">
        <h2 className="font-semibold tracking-tight">By order</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Each lead order — its premium, commission and return.</p>
        <div className="mt-4 space-y-2">
          {campaigns.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              No paid lead orders yet. Free self-assigned leads show a $0 lead spend, so any premium you log is pure net.
            </p>
          )}
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-4 py-3 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.delivered} delivered · {c.closed} closed · {money(c.costCents)} spend
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold tabular-nums">{money(c.netCents)}</div>
                <div className="text-xs text-muted-foreground">{roiLabel(c.roi)} return</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground">
        Net = commission earned + buyback credit − lead spend. Log a sale by dragging a lead to{" "}
        <span className="font-medium">Issued PAID</span> in your pipeline and entering its annual premium.
      </p>
    </div>
  );
}
