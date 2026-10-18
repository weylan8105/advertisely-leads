"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Check, Repeat, CalendarClock, Gauge, Lock, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AVAILABLE_STATES } from "@/data/states";
import { formatCurrency, cn } from "@/lib/utils";

interface SubData {
  available: boolean;
  canSubscribe: boolean;
  subscribed: boolean;
  weeklyCents: number;
  pricePerLeadCents: number;
  leadsPerWeek: number;
  minWeeks: number;
  licensedStates?: string[];
  // when subscribed:
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

export default function SubscriptionPage() {
  const [data, setData] = useState<SubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [states, setStates] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    fetch("/api/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: SubData | null) => {
        setData(d);
        if (d && !d.subscribed && d.licensedStates?.length) setStates(d.licensedStates);
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    try {
      const p = new URLSearchParams(window.location.search).get("status");
      if (p === "success") setBanner({ ok: true, text: "You're subscribed! Your first week of leads is on the way." });
      if (p === "cancel") setBanner({ ok: false, text: "Checkout canceled — you weren't charged." });
      if (p) window.history.replaceState({}, "", "/subscription");
    } catch {}
  }, []);

  const weekly = data ? formatCurrency(data.weeklyCents / 100) : "$500";
  const perLead = data ? formatCurrency(data.pricePerLeadCents / 100) : "$55";
  const perWeek = data?.leadsPerWeek ?? 9;
  const minWeeks = data?.minWeeks ?? 4;

  const toggleState = (s: string) =>
    setStates((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  async function subscribe() {
    setError(null);
    if (states.length === 0) { setError("Pick at least one state for your leads."); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/subscription/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ states }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error ?? "Could not start checkout");
      window.location.href = d.url;
    } catch (e: any) {
      setError(e.message ?? "Could not start checkout");
      setBusy(false);
    }
  }

  async function cancel() {
    if (!window.confirm("Cancel your lead subscription?")) return;
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

  return (
    <div>
      <PageHeader
        title="Subscribe & Save"
        description="Lock in a steady weekly flow of fresh leads — delivered automatically, every week."
      />

      {banner && (
        <div className={cn("mb-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
          banner.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900")}>
          {banner.ok ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />}
          {banner.text}
        </div>
      )}

      {loading ? (
        <Card className="p-12 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : !data?.available ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Subscriptions aren&apos;t set up on the server yet.
        </Card>
      ) : !data.subscribed && !data.canSubscribe ? (
        <Card className="p-8 text-center max-w-xl mx-auto">
          <Repeat className="h-10 w-10 text-brand-red mx-auto mb-3" />
          <h3 className="text-lg font-semibold">Subscribe &amp; Save is coming soon</h3>
          <p className="text-sm text-muted-foreground mt-1">
            A steady weekly flow of fresh leads, delivered automatically. We&apos;re piloting it now —
            it&apos;ll open up shortly.
          </p>
        </Card>
      ) : data.subscribed ? (
        // ── Active subscription ──────────────────────────────────────────
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

            {!data.cancelAt && (
              <div className="mt-4">
                <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {data.canCancel ? "Cancel subscription" : `Cancel (ends after ${minWeeks}-week minimum)`}
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
      ) : (
        // ── Subscribe ────────────────────────────────────────────────────
        <div className="grid gap-5 md:grid-cols-3">
          <Card className="p-6 md:col-span-2">
            <h3 className="text-lg font-semibold">Pick your states</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Your weekly leads will come from these states.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {AVAILABLE_STATES.map((s) => {
                const on = states.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleState(s)}
                    className={cn("rounded-lg border px-3 py-1.5 text-sm transition-colors",
                      on ? "border-brand-red bg-brand-red/[0.06] text-brand-red font-medium" : "border-slate-200 hover:border-slate-300")}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
            <Button className="mt-5" onClick={subscribe} disabled={busy || states.length === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Repeat className="h-4 w-4" />}
              Subscribe — {weekly}/week
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {minWeeks}-week minimum ({formatCurrency((data.weeklyCents * minWeeks) / 100)} total), then auto-renews weekly. Cancel anytime after the minimum.
            </p>
          </Card>

          <Card className="p-6 bg-gradient-to-b from-brand-red/[0.04] to-transparent">
            <div className="text-3xl font-semibold">{weekly}<span className="text-sm font-normal text-muted-foreground">/week</span></div>
            <div className="text-sm text-muted-foreground mt-1">~{perWeek} fresh leads every week</div>
            <ul className="mt-4 space-y-2 text-sm">
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> {perLead}/lead — real-time, under 48 hours old</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Delivered automatically, every week</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Leftover rolls over — nothing wasted</li>
              <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" /> Auto-renews until you cancel</li>
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
