"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, Repeat, CalendarClock, Gauge, Lock, AlertCircle, LogIn } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AVAILABLE_STATES } from "@/data/states";
import { formatCurrency, cn } from "@/lib/utils";

interface SubData {
  available: boolean;
  canSubscribe: boolean;
  subscribed: boolean;
  weeklyCents: number;
  minWeeklyCents: number;
  pricePerLeadCents: number;
  leadsPerWeek: number;
  minWeeks: number;
  licensedStates?: string[];
  status?: string;
  filterStates?: string[];
  weeksBilled?: number;
  currentPeriodEnd?: string | null;
  cancelAt?: string | null;
  canCancel?: boolean;
  totalDelivered?: number;
  weeksDelivered?: number;
  thisWeek?: { quantity: number; fulfilled: number } | null;
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—";

const SUPPORT_EMAIL = "support@advertisely.io";

export function SubscriptionPanel() {
  const [data, setData] = useState<SubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [states, setStates] = useState<string[]>([]);
  const [inv, setInv] = useState<Record<string, number>>({}); // fresh stock per state
  const [weeklyDollars, setWeeklyDollars] = useState(500); // customizable, $500 min
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  // Shown when someone tries to cancel before the 4-week minimum is met.
  const [showSupport, setShowSupport] = useState(false);

  const load = () =>
    fetch("/api/subscription")
      .then((r) => {
        if (r.status === 401) { setNeedsAuth(true); return null; }
        return r.ok ? r.json() : null;
      })
      .then((d: SubData | null) => {
        setData(d);
        if (d && !d.subscribed) {
          if (d.licensedStates?.length) setStates(d.licensedStates);
          if (d.minWeeklyCents) setWeeklyDollars(Math.round(d.minWeeklyCents / 100));
        }
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    // Live per-state fresh stock (the "lead bank") for the state picker.
    fetch("/api/inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.byState) setInv(d.byState); })
      .catch(() => {});
    try {
      const p = new URLSearchParams(window.location.search).get("status");
      if (p === "success") setBanner({ ok: true, text: "You're subscribed! Your first week of leads is on the way." });
      if (p === "cancel") setBanner({ ok: false, text: "Checkout canceled — you weren't charged." });
      if (p) {
        const u = new URL(window.location.href);
        u.searchParams.delete("status");
        window.history.replaceState({}, "", u.pathname + u.search);
      }
    } catch {}
  }, []);

  const weekly = data ? formatCurrency(data.weeklyCents / 100) : "$500";
  const perLead = data ? formatCurrency(data.pricePerLeadCents / 100) : "$55";
  const perWeek = data?.leadsPerWeek ?? 9;
  const minWeeks = data?.minWeeks ?? 4;
  const minDollars = data?.minWeeklyCents ? Math.round(data.minWeeklyCents / 100) : 500;
  const formLeads = Math.floor(weeklyDollars / 55); // leads at the chosen weekly amount

  const toggleState = (s: string) =>
    setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function subscribe() {
    setError(null);
    if (states.length === 0) { setError("Pick at least one state for your leads."); return; }
    if (weeklyDollars < minDollars) { setError(`Minimum is ${formatCurrency(minDollars)}/week.`); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states, weeklyCents: Math.round(weeklyDollars) * 100 }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error ?? "Could not start checkout");
      window.location.href = d.url;
    } catch (e: any) {
      setError(e.message ?? "Could not start checkout");
      setBusy(false);
    }
  }

  function requestCancel() {
    // Self-service cancel only after the 4-week minimum; otherwise → support.
    if (!data?.canCancel) {
      setShowSupport(true);
      return;
    }
    doCancel();
  }

  async function doCancel() {
    if (!window.confirm("Cancel your lead subscription? It ends at the end of this week.")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/subscription/cancel", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not cancel");
      setBanner({ ok: true, text: d.message ?? "Your subscription will be canceled." });
      load();
    } catch (e: any) {
      setError(e.message ?? "Could not cancel");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card className="p-12 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (needsAuth) {
    return (
      <Card className="p-8 text-center max-w-xl mx-auto">
        <LogIn className="h-9 w-9 text-brand-red mx-auto mb-3" />
        <h3 className="text-lg font-semibold">Sign in to subscribe</h3>
        <p className="text-sm text-muted-foreground mt-1">Log in to start a weekly lead subscription.</p>
        <a href="/login?callbackUrl=/marketplace?tab=subscribe" className="inline-block mt-4">
          <Button>Sign in</Button>
        </a>
      </Card>
    );
  }

  if (!data?.available) {
    return <Card className="p-8 text-center text-sm text-muted-foreground">Subscriptions aren&apos;t set up yet.</Card>;
  }

  const banners = banner && (
    <div className={cn("mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
      banner.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>
      {banner.ok ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />}
      {banner.text}
    </div>
  );

  // Active subscription
  if (data.subscribed) {
    return (
      <div>
        {banners}
        <div className="grid gap-5 md:grid-cols-3">
          <Card className="p-5 md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">Your lead subscription</h3>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                data.status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : data.status === "past_due" ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-slate-50 text-slate-600")}>
                {data.status === "active" ? "Active" : data.status === "past_due" ? "Payment due" : data.status}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Repeat className="h-3 w-3" /> Weekly</div>
                <div className="text-xl font-semibold">{weekly}</div>
                <div className="text-[11px] text-muted-foreground">{perWeek} leads</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><Gauge className="h-3 w-3" /> Delivered</div>
                <div className="text-xl font-semibold">{data.totalDelivered ?? 0}</div>
                <div className="text-[11px] text-muted-foreground">{data.weeksDelivered ?? 0} weeks</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" /> Next charge</div>
                <div className="text-sm font-semibold mt-1">{data.cancelAt ? "—" : fmtDate(data.currentPeriodEnd)}</div>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <div className="text-[11px] text-muted-foreground">Minimum</div>
                <div className="text-xl font-semibold">{Math.min(data.weeksBilled ?? 0, minWeeks)}/{minWeeks}</div>
                <div className="text-[11px] text-muted-foreground">weeks billed</div>
              </div>
            </div>
            <div className="mt-4 text-sm">
              <span className="text-muted-foreground">States: </span>
              <span className="font-medium">{(data.filterStates ?? []).join(", ") || "—"}</span>
            </div>
            {data.cancelAt ? (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Scheduled to end on <span className="font-semibold">{fmtDate(data.cancelAt)}</span>. You keep getting leads until then.
              </div>
            ) : (data.weeksBilled ?? 0) < minWeeks ? (
              <p className="mt-4 text-xs text-muted-foreground inline-flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5" /> You&apos;re in your {minWeeks}-week minimum. You can cancel after week {minWeeks}.
              </p>
            ) : null}
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            {showSupport && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                <span>
                  You&apos;re still in your {minWeeks}-week minimum ({data.weeksBilled ?? 0} of {minWeeks} payments made).
                  To cancel before the minimum is met, please contact support at{" "}
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="font-medium underline">{SUPPORT_EMAIL}</a>.
                </span>
              </div>
            )}
            {!data.cancelAt && (
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={requestCancel} disabled={busy}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Cancel subscription
                </Button>
              </div>
            )}
          </Card>
          <Card className="p-5">
            <div className="text-sm font-semibold mb-2">How it works</div>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> {weekly}/week, charged automatically.</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> ~{perWeek} fresh leads/week at {perLead}/lead.</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Leftover rolls over — no money wasted.</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Auto-renews weekly until you cancel.</li>
            </ul>
          </Card>
        </div>
      </div>
    );
  }

  // Subscribe
  return (
    <div>
      {banners}
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="p-6 md:col-span-2">
          {/* Weekly budget — customizable, $500 minimum */}
          <h3 className="text-lg font-semibold">Set your weekly budget</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {formatCurrency(minDollars)}/week minimum — go higher for more leads. Each lead is {perLead}.
          </p>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <div className="inline-flex items-center rounded-lg border border-slate-200 h-10">
              <button type="button" onClick={() => setWeeklyDollars((v) => Math.max(minDollars, v - 55))}
                className="h-full w-10 grid place-items-center text-muted-foreground hover:text-foreground">−</button>
              <div className="flex items-center h-full px-2 border-x border-slate-200">
                <span className="text-muted-foreground">$</span>
                <input type="number" min={minDollars} step={5} value={weeklyDollars}
                  onChange={(e) => setWeeklyDollars(Math.max(minDollars, Math.round(Number(e.target.value) || minDollars)))}
                  className="w-20 text-center outline-none" />
                <span className="text-muted-foreground text-sm">/wk</span>
              </div>
              <button type="button" onClick={() => setWeeklyDollars((v) => v + 55)}
                className="h-full w-10 grid place-items-center text-muted-foreground hover:text-foreground">+</button>
            </div>
            <span className="text-sm text-muted-foreground">≈ <span className="font-semibold text-foreground">{formLeads}</span> fresh leads/week</span>
          </div>

          {/* States */}
          <h3 className="text-lg font-semibold mt-6">Pick your states</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Your weekly leads will come from these states. The number is how many are in stock right now.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {AVAILABLE_STATES.map((s) => {
              const on = states.includes(s);
              const count = inv[s] ?? 0;
              return (
                <button key={s} onClick={() => toggleState(s)}
                  className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors inline-flex items-center gap-1.5",
                    on ? "border-brand-red bg-brand-red/[0.06] text-brand-red font-medium" : "border-slate-200 hover:border-slate-300")}>
                  {s}
                  {count > 0 ? (
                    <span className="text-[10px] font-semibold text-emerald-600">{count}</span>
                  ) : (
                    <span className="text-[9px] text-muted-foreground">fresh</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-emerald-700">Green number</span> = leads in stock, ready now.
            <span className="font-medium"> “fresh”</span> = none in stock yet — delivered fresh in real time as they&apos;re generated.
          </p>

          {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
          <Button className="mt-5" onClick={subscribe} disabled={busy || states.length === 0 || weeklyDollars < minDollars}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
            Subscribe — {formatCurrency(weeklyDollars)}/week
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {minWeeks}-week minimum ({formatCurrency(weeklyDollars * minWeeks)} total), then auto-renews weekly. Cancel anytime after the minimum.
          </p>
        </Card>
        <Card className="p-6 bg-gradient-to-b from-brand-red/[0.04] to-transparent">
          <div className="text-3xl font-semibold">{formatCurrency(weeklyDollars)}<span className="text-sm font-normal text-muted-foreground">/week</span></div>
          <div className="text-sm text-muted-foreground mt-1">≈ {formLeads} fresh leads every week</div>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> {perLead}/lead — fresh, under 48 hours old</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Delivered automatically, every week</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Leftover rolls over — nothing wasted</li>
            <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> {formatCurrency(minDollars)}/week minimum, then auto-renews</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
