"use client";

import { useEffect, useRef, useState } from "react";
import { Wallet, TrendingUp, Users, Target, Loader2, Info, Banknote, CheckCircle2, Trash2 } from "lucide-react";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadCostLedger } from "@/lib/leadCostLedger";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function dateLabel(iso: string | number) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}
// A plain calendar day ("2026-11-09") — no time zone shifting.
function dayLabel(ymd: string) {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Ryan's Enhanced Wealth lock-in quote: one fixed bill for every lead that was
 * first sent to him during the lock-in week, against the bank transfers he
 * records. It stays on his dashboard until it is paid in full, then goes away.
 */
export function LeadCostPanel() {
  const [ledger, setLedger] = useState<LeadCostLedger | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  // Already paid when the page loaded: nothing to show. Paid off just now: keep
  // a short "paid in full" note on screen for this visit.
  const settledOnLoad = useRef(false);

  useEffect(() => {
    fetch("/api/admin/lead-cost")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const l: LeadCostLedger | null = d?.ledger ?? null;
        settledOnLoad.current = !!l?.settled;
        setLedger(l);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) {
    return (
      <Card className="mb-6">
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lead cost…
        </CardContent>
      </Card>
    );
  }
  if (!ledger || !ledger.quote) return null;
  if (ledger.settled && settledOnLoad.current) return null;

  const quote = ledger.quote;
  const range = `${dateLabel(quote.fromIso)} – ${dateLabel(new Date(quote.toIso).getTime() - 1)}`;
  const title = `Quote · Enhanced Wealth Lock In, ${range}`;
  const stillOwed = Math.max(0, -ledger.balanceCents);
  const coveredPct = ledger.owedCents > 0 ? Math.min(100, Math.round((ledger.paidCents / ledger.owedCents) * 100)) : 100;

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
      setOk(`Recorded ${usd(Math.round(dollars * 100))}. Thanks — no need to send anything.`);
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

  const paymentsTable = ledger.payments.length > 0 && (
    <div className="overflow-x-auto">
      <p className="mb-1 text-xs text-muted-foreground">Payments recorded</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1.5 font-medium">Date</th>
            <th className="py-1.5 font-medium">Note</th>
            <th className="py-1.5 text-right font-medium">Amount</th>
            <th className="py-1.5" />
          </tr>
        </thead>
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
  );

  // Paid off during this visit: a short confirmation, gone on the next load.
  if (ledger.settled) {
    return (
      <Card className="mb-6 border-l-4 border-l-emerald-500">
        <CardContent className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <CheckCircle2 className="h-4 w-4" /> Lock-in quote paid in full: {usd(ledger.paidCents)} of {usd(ledger.owedCents)}. Thank you.
          </p>
          <p className="text-xs text-muted-foreground">This panel won&apos;t show again. Recorded an amount by mistake? Remove it below and the quote comes back.</p>
          {paymentsTable}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mb-6 space-y-4">
      {/* Headline bar: the quote vs what's been paid */}
      <Card className="border-l-4 border-l-rose-500">
        <CardContent className="py-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
              <span className="text-sm">
                <span className="font-semibold">{usd(ledger.paidCents)}</span>
                <span className="text-muted-foreground"> paid of {usd(ledger.owedCents)}</span>
              </span>
            </div>
            <span className="text-sm font-semibold tabular-nums text-rose-600">{usd(stillOwed)} still owed</span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-sky-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coveredPct} aria-label="Lock-in quote paid">
            <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${coveredPct}%` }} />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {coveredPct}% paid · {quote.leads} leads × {usd(quote.cplCents)} per lead · stays here until it&apos;s paid
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <DashboardStatCard label="Leads billed" value={quote.leads} hint={quote.clientLeads > 0 ? `${quote.sentLeads} sent to you − ${quote.clientLeads} to clients` : range} icon={<Users className="h-4 w-4" />} accent="violet" />
        <DashboardStatCard label="Avg. cost per lead" value={usd(quote.cplCents)} hint="Ad spend ÷ leads" icon={<Target className="h-4 w-4" />} accent="amber" />
        <DashboardStatCard label="Quote total" value={usd(ledger.owedCents)} hint="Leads × cost per lead" icon={<TrendingUp className="h-4 w-4" />} accent="blue" />
        <DashboardStatCard label="Paid" value={usd(ledger.paidCents)} hint="Your recorded transfers" icon={<Wallet className="h-4 w-4" />} accent="emerald" />
        <DashboardStatCard label="Still owed" value={usd(stillOwed)} hint="Pay this to settle" icon={<Banknote className="h-4 w-4" />} accent="amber" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Record a bank transfer */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Record a payment</CardTitle>
            <CardDescription>Paid Advertisely by bank transfer? Enter the amount — that&apos;s all, we trust it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(stillOwed / 100).toFixed(2)} className="h-9 w-full rounded-md border border-slate-200 pl-6 pr-3 text-sm outline-none focus:border-brand-red" aria-label="Amount paid" />
              </div>
              <Button onClick={recordPayment} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record"}
              </Button>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional, e.g. wire ref)" className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-brand-red" aria-label="Payment note" />
            {ok && <p className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {ok}</p>}
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </CardContent>
        </Card>

        {/* Breakdown + payments */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Lock-in leads, {range}</CardTitle>
            <CardDescription>
              Every lead that was first sent to you from the start of the lock-in until your routing was paused, at {usd(quote.cplCents)} each. A lead counts whether it stayed in your pipeline, went to the Goldmine or was passed to a teammate. Leads handed on to clients are their cost, so they come off. Clients&apos; own campaign leads were never included.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-1.5 text-sm">
              {([
                ...quote.lines.map((l) => [l.label, `${l.leads} leads`, ""] as [string, string, string]),
                ["Sent to you first", `${quote.sentLeads} leads`, "font-medium border-t border-slate-100 pt-1.5"],
                ...(quote.clientLeads > 0
                  ? ([
                      ["Handed on to clients, who pay for them", `− ${quote.clientLeads} leads`, "text-muted-foreground"],
                      ["Leads billed", `${quote.leads} leads`, "font-medium border-t border-slate-100 pt-1.5"],
                    ] as [string, string, string][])
                  : []),
                [`Avg. cost per lead (${usd0(quote.adSpendCents)} ad spend ÷ ${quote.leadsGenerated} leads Meta counted)`, usd(quote.cplCents), "text-muted-foreground"],
                ["Quote total", usd(ledger.owedCents), "font-semibold"],
                ["Paid", `− ${usd(ledger.paidCents)}`, "text-muted-foreground"],
                ["Still owed", usd(stillOwed), "font-semibold border-t border-slate-100 pt-1.5 text-rose-600"],
              ] as [string, string, string][]).map(([label, value, clsName]) => (
                <div key={label} className={cn("flex justify-between gap-4", clsName)}>
                  <dt>{label}</dt>
                  <dd className="shrink-0">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="text-xs text-muted-foreground">
              Sent to you by day: {quote.days.map((d) => `${dayLabel(d.date)} · ${d.leads}`).join(", ")}
              {quote.clients.length > 0 && (
                <>
                  <br />
                  Handed on to clients: {quote.clients.map((c) => `${c.name} · ${c.leads}`).join(", ")}
                </>
              )}
            </p>

            {paymentsTable}

            {ledger.earlierPayments.length > 0 && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-slate-700">Earlier payment{ledger.earlierPayments.length > 1 ? "s" : ""}, not applied to this quote</p>
                {ledger.earlierPayments.map((p) => (
                  <p key={p.id}>
                    {usd(p.amountCents)} on {dateLabel(p.at)}
                    {p.note ? ` (${p.note})` : ""}
                  </p>
                ))}
                <p className="mt-1">{quote.earlierPaymentsNote}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          This is a fixed quote for the lock-in week: the leads first sent to you, less the ones handed on to clients. The cost per lead is what our own campaigns spent {range}, divided by the leads they produced. Record each bank transfer you send and the balance updates — no receipts or verification needed. Once it&apos;s paid in full, this panel goes away.
        </span>
      </p>
    </div>
  );
}
