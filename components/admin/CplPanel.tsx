"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, RefreshCw, AlertCircle, DollarSign, Check } from "lucide-react";
import { formatCurrency, cn } from "@/lib/utils";

interface Cpl {
  configured: boolean;
  account: string | null;
  windowDays: number;
  spendCents: number;
  leads: number;
  cplCents: number | null;
  cplSource: "meta" | "manual" | "none";
  manualCplCents: number | null;
  manualCplUpdatedAt: string | null;
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
  const [cplInput, setCplInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = (refresh = false) => {
    setLoading(true);
    fetch(`/api/admin/cpl${refresh ? "?refresh=1" : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Cpl | null) => {
        setData(d);
        if (d?.manualCplCents != null) setCplInput((d.manualCplCents / 100).toString());
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function saveManual() {
    const dollars = Number(cplInput);
    if (!Number.isFinite(dollars) || dollars < 0) return;
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/cpl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cplDollars: dollars }),
      });
      if (res.ok) {
        setSaved(true);
        load(); // refresh the floor/source with the new value
        setTimeout(() => setSaved(false), 2500);
      }
    } finally {
      setSaving(false);
    }
  }

  const sourceLabel =
    data?.cplSource === "meta" ? "Live (Meta API)" : data?.cplSource === "manual" ? "Manual entry" : "Not set";

  return (
    <Card className="mb-4 border-brand-red/30">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-brand-red" />
            Cost per lead — Enhanced Wealth
          </CardTitle>
          <CardDescription>
            Facebook CPL → the 2× price floor for fresh Advertisely leads (min {data ? money(data.hardMinCents) : "$45"}).
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
        ) : (
          <>
            {data.cplSource === "none" ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <div>
                  <div className="font-medium">No CPL set yet.</div>
                  Enter your current 7-day Facebook CPL below to activate the price floor. Until then the
                  fresh floor is the {money(data.hardMinCents)} minimum (current fresh price {money(data.baseFreshCents)}).
                </div>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat
                    label="Cost per lead"
                    value={data.cplCents != null ? money(data.cplCents) : "—"}
                    sub={sourceLabel}
                  />
                  {data.cplSource === "meta" ? (
                    <>
                      <Stat label="Ad spend (7d)" value={money(data.spendCents)} />
                      <Stat label="Leads (7d)" value={data.leads.toLocaleString()} />
                    </>
                  ) : (
                    <Stat
                      label="2× CPL"
                      value={money((data.cplCents ?? 0) * data.multiplier)}
                      sub={`min ${money(data.hardMinCents)}`}
                    />
                  )}
                  <Stat
                    label="Fresh price floor"
                    value={money(data.effectiveFreshCents)}
                    sub={`2× CPL = ${money((data.cplCents ?? 0) * data.multiplier)}, min ${money(data.hardMinCents)}`}
                  />
                </div>
                <div
                  className={cn(
                    "mt-3 rounded-lg px-4 py-2.5 text-sm",
                    data.floorAboveBase
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border border-slate-200 bg-slate-50 text-slate-600",
                  )}
                >
                  {data.floorAboveBase ? (
                    <>The 2× floor (<strong>{money(data.floorCents)}</strong>) is above the current fresh price
                      ({money(data.baseFreshCents)}) — enforcing it would raise the fresh lead price to
                      {" "}<strong>{money(data.effectiveFreshCents)}</strong>.</>
                  ) : (
                    <>Current fresh price ({money(data.baseFreshCents)}) already covers the 2× floor
                      ({money(data.floorCents)}) — no increase needed right now.</>
                  )}
                </div>
              </>
            )}

            {/* Manual CPL entry — always available */}
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="text-xs font-medium text-foreground">Set CPL manually</div>
              <p className="text-[11px] text-muted-foreground">
                Your current 7-day Facebook cost-per-lead (read it off Ads Manager). Used until the Meta API is
                connected; update it whenever your CPL changes.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={cplInput}
                    onChange={(e) => setCplInput(e.target.value)}
                    placeholder="0.00"
                    className="h-9 w-32 pl-5"
                    aria-label="Manual CPL in dollars"
                  />
                </div>
                <Button size="sm" onClick={saveManual} disabled={saving || cplInput === ""}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
                  {saved ? "Saved" : "Save CPL"}
                </Button>
                {data.manualCplCents != null && (
                  <span className="text-[11px] text-muted-foreground">
                    Current manual CPL: <strong>{money(data.manualCplCents)}</strong>
                    {data.manualCplUpdatedAt && ` · updated ${new Date(data.manualCplUpdatedAt).toLocaleDateString()}`}
                    {data.cplSource === "meta" && " (Meta API is live, so it's using that instead)"}
                  </span>
                )}
              </div>
            </div>

            {data.error && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 px-4 py-2.5 text-xs text-rose-800">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-600" />
                <div>
                  <span className="font-medium">Meta API error:</span> {data.error}
                  {data.account && <span className="text-rose-500"> (account {data.account})</span>} — using the manual CPL above.
                </div>
              </div>
            )}

            <p className="mt-2 text-[11px] text-muted-foreground">
              {data.cplSource === "meta" && data.account ? `Account ${data.account} · updated ${new Date(data.fetchedAt).toLocaleString()}. ` : ""}
              Preview only — price enforcement goes live once you give the go-ahead.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
