"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, DollarSign, RotateCcw, Trophy, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";

interface Summary {
  netCents: number;
  commissionCents: number;
  costCents: number;
  buybackCents: number;
  policiesSold: number;
  delivered: number;
  apCents: number;
  roi: number | null;
}

const money = (c: number) => formatCurrency(Math.round(c) / 100);

export function PnlSummary() {
  const [s, setS] = useState<Summary | null>(null);

  useEffect(() => {
    fetch("/api/pnl")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setS(d.summary))
      .catch(() => {});
  }, []);

  const card = (label: string, value: string, hint: string, icon: React.ReactNode, accent: string) => (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="text-[10px] font-semibold tracking-wide uppercase text-muted-foreground">{label}</div>
        <div className={cn("h-8 w-8 grid place-items-center rounded-lg", accent)}>{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
    </Card>
  );

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase text-brand-red">Your numbers</div>
          <p className="text-xs text-muted-foreground">All-time performance across every order.</p>
        </div>
        <Link href="/pnl" className="text-sm text-brand-red hover:underline inline-flex items-center gap-1">
          Full P&amp;L <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {card(
          "Net profit",
          s ? money(s.netCents) : "—",
          s && s.roi != null ? `${s.roi.toFixed(1)}× on lead spend` : s ? `after ${money(s.costCents)} spend` : " ",
          <TrendingUp className="h-4 w-4 text-emerald-600" />,
          "bg-emerald-500/15",
        )}
        {card(
          "Commission earned",
          s ? money(s.commissionCents) : "—",
          s ? `${money(s.apCents)} premium written` : " ",
          <DollarSign className="h-4 w-4 text-emerald-600" />,
          "bg-emerald-500/15",
        )}
        {card(
          "Buyback credit",
          s ? money(s.buybackCents) : "—",
          "earned back on dead leads",
          <RotateCcw className="h-4 w-4 text-blue-600" />,
          "bg-blue-500/15",
        )}
        {card(
          "Policies sold",
          s ? String(s.policiesSold) : "—",
          s ? `from ${s.delivered} leads delivered` : " ",
          <Trophy className="h-4 w-4 text-violet-600" />,
          "bg-violet-500/15",
        )}
      </div>
    </div>
  );
}
