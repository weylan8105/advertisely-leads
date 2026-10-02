"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertCircle, DollarSign } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

interface Cpl {
  configured: boolean;
  account: string | null;
  windowDays: number;
  spendCents: number;
  leads: number;
  cplCents: number | null;
  error?: string;
  multiplier: number;
  hardMinCents: number;
  baseFreshCents: number;
  floorCents: number;
  effectiveFreshCents: number;
  floorAboveBase: boolean;
  fetchedAt: string;
}

const money = (c: number) => formatCurrency(c / 100);

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export function CplPanel() {
  const [data, setData] = useState<Cpl | null>(null);
  const [loading, setLoading] = useState(true);

  const load = (refresh = false) => {
    setLoading(true);
    fetch(`/api/admin/cpl${refresh ? "?refresh=1" : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <Card className="mb-4 border-brand-red/30">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-brand-red" />
            Cost per lead — Enhanced Wealth
          </CardTitle>
          <CardDescription>
            Facebook CPL (trailing 7 days) → the 2× price floor for fresh Advertisely leads (min $45).
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && !data ? (
          <div className="flex items-center gap-2 justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !data ? (
          <div className="text-sm text-rose-600 py-4">Couldn’t load CPL.</div>
        ) : !data.configured ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <div>
              <div className="font-medium">Not connected yet.</div>
              Add the Enhanced Wealth ad account to activate live CPL tracking — set
              {" "}<code className="rounded bg-amber-100 px-1">META_ADS_ACCESS_TOKEN</code> (an ads_read
              token) and <code className="rounded bg-amber-100 px-1">ENHANCED_WEALTH_AD_ACCOUNT_ID</code>.
              Until then the fresh price floor is the $45 minimum (current fresh price {money(data.baseFreshCents)}).
            </div>
          </div>
        ) : data.error ? (
          <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-600" />
            <div>
              <div className="font-medium">Facebook API error</div>
              {data.error} <span className="text-rose-500">(account {data.account})</span>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="Cost per lead (7d)" value={data.cplCents != null ? money(data.cplCents) : "—"}
                sub={data.cplCents == null ? "no leads in window" : undefined} />
              <Stat label="Ad spend (7d)" value={money(data.spendCents)} />
              <Stat label="Leads (7d)" value={data.leads.toLocaleString()} />
              <Stat label="Fresh price floor" value={money(data.effectiveFreshCents)}
                sub={`2× CPL = ${money((data.cplCents ?? 0) * 2)}, min ${money(data.hardMinCents)}`} />
            </div>
            <div className={cn(
              "mt-3 rounded-lg px-4 py-2.5 text-sm",
              data.floorAboveBase ? "border border-emerald-200 bg-emerald-50 text-emerald-900" : "border border-slate-200 bg-slate-50 text-slate-600",
            )}>
              {data.floorAboveBase ? (
                <>The 2× floor (<strong>{money(data.floorCents)}</strong>) is above the current fresh price
                  ({money(data.baseFreshCents)}) — enforcing it would raise the fresh lead price to
                  {" "}<strong>{money(data.effectiveFreshCents)}</strong>.</>
              ) : (
                <>Current fresh price ({money(data.baseFreshCents)}) already covers the 2× floor
                  ({money(data.floorCents)}) — no increase needed right now.</>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Account {data.account} · updated {new Date(data.fetchedAt).toLocaleString()}. Preview only —
              price enforcement goes live once the number is verified.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
