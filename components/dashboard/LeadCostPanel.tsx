"use client";

import { useEffect, useState } from "react";
import { Wallet, Users, Target, Loader2, Info, Banknote, CheckCircle2, Trash2, Gauge, PauseCircle } from "lucide-react";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadBillingMode, LeadCostLedger } from "@/lib/leadCostLedger";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateLabel(iso: string | number) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}
// A plain calendar day ("2026-11-18"), no time zone shifting.
function dayLabel(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * What the admins owe Advertisely for the leads routed to them: the reverse of a
 * client's ad-spend balance. Every lead is locked at its campaign's rolling
 * 3-day cost per lead on the day it arrived; bank transfers recorded here pay it
 * down. The owners choose here whether leads are advanced (pay after) or paid
 * for first (leads only while the balance covers them).
 * Owner-only (lib/leadCostLedger.ts).
 */
export function LeadCostPanel() {
  const [ledger, setLedger] = useState<LeadCostLedger | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    fetch("/api/admin/lead-cost")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setLedger(d?.ledger ?? null))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading what admins owe…
        </CardContent>
      </Card>
    );
  }
  if (!ledger) return null;

  const owed = ledger.stillOwedCents;
  const credit = Math.max(0, ledger.balanceCents);
  const paidPct = ledger.owedCents > 0 ? Math.min(100, Math.round((ledger.paidCents / ledger.owedCents) * 100)) : 100;
  const since = dateLabel(ledger.startIso);
  const target = ledger.weeklyTarget;
  const prepay = ledger.mode === "prepay";
  const weekCostCents = target ? target * ledger.typicalCplCents : null;

  async function chooseMode(mode: LeadBillingMode) {
    if (!ledger || mode === ledger.mode || switching) return;
    if (
      mode === "prepay" &&
      ledger.stillOwedCents > 0 &&
      !window.confirm(
        `You owe ${usd(ledger.stillOwedCents)} right now. On pay first, no more leads arrive until that is paid and there is money left for the next lead. Switch anyway?`,
      )
    ) {
      return;
    }
    setError(null);
    setOk(null);
    setSwitching(true);
    try {
      const res = await fetch("/api/admin/lead-cost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ledger) throw new Error(data.error ?? "Could not change how you pay.");
      setLedger(data.ledger);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSwitching(false);
    }
  }

  async function recordPayment() {
    const dollars = Number(amount.replace(/[^0-9.\-]/g, ""));
    if (!dollars) {
      setError("Enter the amount you paid.");
      return;
    }
    setError(null);
    setOk(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/lead-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: Math.round(dollars * 100), note: note.trim() || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not record the payment.");
      setLedger(data.ledger);
      setAmount("");
      setNote("");
      setOk(`Recorded ${usd(Math.round(dollars * 100))}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function deletePayment(id: string) {
    setError(null);
    const res = await fetch(`/api/admin/lead-cost?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setLedger(data.ledger);
    else setError(data.error ?? "Could not remove that payment.");
  }

  return (
    <div className="mb-6 space-y-4">
      {/* How the admins pay for their leads */}
      <Card>
        <CardContent className="py-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            How you pay for your leads
            {switching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="How you pay for your leads">
            {(
              [
                {
                  mode: "advance",
                  title: "Leads first, pay after",
                  body: "Leads arrive with nothing paid up front. Each one is added to the balance you owe, at cost.",
                },
                {
                  mode: "prepay",
                  title: "Pay first, then leads",
                  body: "Record a payment and leads arrive until it is used up, at cost. None arrive while the balance can't cover the next lead.",
                },
              ] as { mode: LeadBillingMode; title: string; body: string }[]
            ).map((o) => {
              const on = ledger.mode === o.mode;
              return (
                <button
                  key={o.mode}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={switching}
                  onClick={() => chooseMode(o.mode)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    on ? "border-brand-red bg-brand-red/5" : "border-slate-200 hover:border-slate-300",
                  )}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <span className={cn("h-3 w-3 shrink-0 rounded-full border", on ? "border-brand-red bg-brand-red" : "border-slate-300")} />
                    {o.title}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{o.body}</p>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Cost of the next lead today: {ledger.nextPrices.filter((p) => p.key !== "other").map((p) => `${p.label} ${usd(p.cents)}`).join(" · ")}
            {weekCostCents != null && ` · a full week at your target of ${target} is about ${usd(weekCostCents)}`}
          </p>
        </CardContent>
      </Card>

      {prepay && ledger.onHold && (
        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="flex items-start gap-2 py-3 text-sm">
            <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              <span className="font-semibold">Your leads are on hold.</span>{" "}
              {owed > 0
                ? `You owe ${usd(owed)}. Record a payment for more than that and leads start again.`
                : `${usd(credit)} is left, less than the cost of one lead. Record a payment and leads start again.`}
            </span>
          </CardContent>
        </Card>
      )}

      {/* Headline: what's owed */}
      <Card className={cn("border-l-4", owed > 0 ? "border-l-rose-500" : "border-l-emerald-500")}>
        <CardContent className="py-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Admin lead balance · since {since}</div>
              <span className="text-sm">
                <span className="font-semibold">{usd(ledger.paidCents)}</span>
                <span className="text-muted-foreground"> paid of {usd(ledger.owedCents)} owed for {ledger.totalLeads} leads</span>
              </span>
            </div>
            {owed > 0 ? (
              <span className="text-2xl font-semibold tabular-nums text-rose-600">{usd(owed)} owed</span>
            ) : (
              <span className="text-2xl font-semibold tabular-nums text-emerald-600">
                {credit > 0 ? `${usd(credit)} ${prepay ? "left" : "ahead"}` : "All paid"}
              </span>
            )}
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-rose-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={paidPct} aria-label="Lead balance paid">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${paidPct}%` }} />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {prepay && credit > 0
              ? `Covers about ${ledger.leadsCovered} more ${ledger.leadsCovered === 1 ? "lead" : "leads"} at ${usd(ledger.typicalCplCents)} each · every lead routed to you comes off it, at that lead's cost`
              : `${paidPct}% paid · grows with every lead routed to you, at that lead's cost`}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <DashboardStatCard
          label="Leads taken"
          value={ledger.totalLeads}
          hint={`since ${since}`}
          icon={<Users className="h-4 w-4" />}
          accent="violet"
        />
        <DashboardStatCard
          label="Avg. cost per lead"
          value={ledger.avgCplCents != null ? usd(ledger.avgCplCents) : "—"}
          hint={`rolling ${ledger.windowDays}-day campaign cost`}
          icon={<Target className="h-4 w-4" />}
          accent="amber"
        />
        <DashboardStatCard
          label="Last 7 days"
          value={target ? `${ledger.last7.leads} / ${target}` : ledger.last7.leads}
          hint={`${usd(ledger.last7.owedCents)} added${target ? " · weekly target" : ""}`}
          icon={<Gauge className="h-4 w-4" />}
          accent="blue"
        />
        <DashboardStatCard
          label="Paid"
          value={usd(ledger.paidCents)}
          hint="Recorded transfers"
          icon={<Wallet className="h-4 w-4" />}
          accent="emerald"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{prepay ? "Add funds" : "Record a payment"}</CardTitle>
            <CardDescription>
              {prepay
                ? "Sent Advertisely a bank transfer? Enter the amount. Leads arrive until it is used up."
                : "Sent Advertisely a bank transfer? Enter the amount and the balance updates."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={((prepay && weekCostCents ? owed + weekCostCents : owed) / 100).toFixed(2)}
                  className="h-9 w-full rounded-md border border-slate-200 pl-6 pr-3 text-sm outline-none focus:border-brand-red"
                  aria-label="Amount paid"
                />
              </div>
              <Button onClick={recordPayment} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record"}
              </Button>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note (optional, e.g. wire ref)"
              className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-brand-red"
              aria-label="Payment note"
            />
            {ok && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> {ok}
              </p>
            )}
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Where it comes from</CardTitle>
            <CardDescription>
              Every lead the round robin has sent to you since {since}, into your CRM or your team Goldmine. Each one is
              priced at its campaign&apos;s ad spend ÷ leads over the {ledger.windowDays} days before it arrived plus that day,
              the same rolling window clients&apos; leads are priced on, and that price is locked in. At cost: no markup and
              no card fee.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 font-medium">Campaign</th>
                  <th className="py-1.5 text-right font-medium">Leads</th>
                  <th className="py-1.5 text-right font-medium">Avg. cost</th>
                  <th className="py-1.5 text-right font-medium">Owed</th>
                </tr>
              </thead>
              <tbody>
                {ledger.lines.map((l) => (
                  <tr key={l.key} className="border-t border-slate-100">
                    <td className="py-1.5">{l.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{l.leads}</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(Math.round(l.owedCents / Math.max(1, l.leads)))}</td>
                    <td className="py-1.5 text-right tabular-nums">{usd(l.owedCents)}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-semibold">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right tabular-nums">{ledger.totalLeads}</td>
                  <td className="py-1.5 text-right tabular-nums">{ledger.avgCplCents != null ? usd(ledger.avgCplCents) : "—"}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(ledger.owedCents)}</td>
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1.5" colSpan={3}>Paid</td>
                  <td className="py-1.5 text-right tabular-nums">− {usd(ledger.paidCents)}</td>
                </tr>
                <tr className={cn("border-t border-slate-100 font-semibold", owed > 0 ? "text-rose-600" : "text-emerald-600")}>
                  <td className="py-1.5" colSpan={3}>{owed > 0 ? "Still owed" : "Balance"}</td>
                  <td className="py-1.5 text-right tabular-nums">{owed > 0 ? usd(owed) : usd(credit)}</td>
                </tr>
              </tbody>
            </table>

            {ledger.days.length > 0 && (
              <p className="text-xs text-muted-foreground">
                By day: {ledger.days.map((d) => `${dayLabel(d.date)} · ${d.leads} (${usd(d.owedCents)})`).join(", ")}
              </p>
            )}

            {ledger.payments.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs text-muted-foreground">Payments recorded</p>
                <table className="w-full text-sm">
                  <tbody>
                    {ledger.payments.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="py-1.5">{new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td className="py-1.5 text-muted-foreground">{p.note ?? "—"}</td>
                        <td className="py-1.5 text-right">{usd(p.amountCents)}</td>
                        <td className="py-1.5 text-right">
                          <button onClick={() => deletePayment(p.id)} className="text-muted-foreground hover:text-rose-600" aria-label="Remove payment">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {prepay
            ? "Leads stop at your weekly lead target or when the balance runs out, whichever comes first."
            : "How many leads you get is still set by your weekly lead target; this only shows what they cost."}
          {ledger.cplSource === "fallback" && " Meta couldn't be read for some days, so those leads use the campaign's standard cost per lead."}{" "}
          <Banknote className="inline h-3 w-3" /> The Nov 9–12 lock-in quote is paid, so it and its payment aren&apos;t counted here.
        </span>
      </p>
    </div>
  );
}
