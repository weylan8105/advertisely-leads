"use client";

import { useEffect, useState } from "react";
import { Wallet, TrendingUp, Users, Target, Loader2, AlertTriangle, Info, Banknote, CheckCircle2, Trash2 } from "lucide-react";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { LeadCostLedger } from "@/lib/leadCostLedger";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

/**
 * Ryan's Enhanced Wealth lead-cost panel — advertiser-style, but it tracks what
 * he owes Advertisely for the leads he's fronting, against the bank transfers he
 * records. Titled "Cost for Enhanced Wealth Lock In" during the lock-in; after it
 * ends Wednesday night it reads as his ongoing lead-cost account.
 */
export function LeadCostPanel() {
  const [ledger, setLedger] = useState<LeadCostLedger | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [cplInput, setCplInput] = useState("");
  const [cplSaving, setCplSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lead cost…
        </CardContent>
      </Card>
    );
  }
  if (!ledger) return null;

  const owes = ledger.balanceCents < 0;
  const title = ledger.lockInActive ? "Cost for Enhanced Wealth Lock In" : "Enhanced Wealth — Lead Cost";
  const coveredPct = ledger.owedCents > 0 ? Math.min(100, Math.round((ledger.paidCents / ledger.owedCents) * 100)) : ledger.paidCents > 0 ? 100 : 0;

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

  async function saveCpl() {
    const dollars = Number(cplInput.replace(/[^0-9.]/g, ""));
    if (!dollars) {
      setError("Enter a cost per lead.");
      return;
    }
    setError(null);
    setCplSaving(true);
    try {
      const res = await fetch("/api/admin/lead-cost", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cplDollars: dollars }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not set the cost per lead.");
      setLedger(data.ledger);
      setCplInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCplSaving(false);
    }
  }

  return (
    <div className="mb-6 space-y-4">
      {/* Headline bar: what's owed vs paid */}
      <Card className={cn("border-l-4", owes ? "border-l-rose-500" : "border-l-emerald-500")}>
        <CardContent className="py-4">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</div>
              <span className="text-sm">
                <span className="font-semibold">{usd0(ledger.paidCents)}</span>
                <span className="text-muted-foreground"> paid of {usd0(ledger.owedCents)} in lead cost</span>
              </span>
            </div>
            <span className={cn("text-sm font-semibold tabular-nums", owes ? "text-rose-600" : "text-emerald-600")}>
              {owes ? `${usd(-ledger.balanceCents)} still owed` : ledger.balanceCents > 0 ? `${usd(ledger.balanceCents)} credit` : "All settled"}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-sky-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coveredPct} aria-label="Lead cost paid">
            <div className={cn("h-full rounded-full transition-all", owes ? "bg-rose-500" : "bg-emerald-500")} style={{ width: `${coveredPct}%` }} />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {coveredPct}% covered
            {ledger.cplCents !== null ? ` · ${usd(ledger.cplCents)} per lead (${ledger.cplSource === "meta" ? "live blended CPL" : "manual"})` : " · set a cost per lead below"}
            {ledger.lockInActive ? ` · lock-in through ${dateLabel(ledger.lockInEndIso)}` : ""}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <DashboardStatCard label="Leads fronted" value={ledger.totalLeads} hint={`${ledger.leadsToHouse} yours · ${ledger.leadsToTeam} team`} icon={<Users className="h-4 w-4" />} accent="violet" />
        <DashboardStatCard label="Cost per lead" value={ledger.cplCents !== null ? usd(ledger.cplCents) : "—"} hint={ledger.cplSource === "meta" ? "Live blended CPL" : ledger.cplSource === "manual" ? "Manual CPL" : "Not set"} icon={<Target className="h-4 w-4" />} accent="amber" />
        <DashboardStatCard label="Total lead cost" value={usd(ledger.owedCents)} hint="Leads × cost per lead" icon={<TrendingUp className="h-4 w-4" />} accent="blue" />
        <DashboardStatCard label="Paid back" value={usd(ledger.paidCents)} hint="Your recorded transfers" icon={<Wallet className="h-4 w-4" />} accent="emerald" />
        <DashboardStatCard label={owes ? "Still owed" : "Balance"} value={owes ? usd(-ledger.balanceCents) : usd(ledger.balanceCents)} hint={owes ? "Pay this to settle" : "Credit on account"} icon={<Banknote className="h-4 w-4" />} accent={owes ? "amber" : "emerald"} />
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
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="h-9 w-full rounded-md border border-slate-200 pl-6 pr-3 text-sm outline-none focus:border-brand-red" aria-label="Amount paid" />
              </div>
              <Button onClick={recordPayment} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record"}
              </Button>
            </div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional, e.g. wire ref)" className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-brand-red" aria-label="Payment note" />
            {ok && <p className="flex items-center gap-1.5 text-xs text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> {ok}</p>}
            {error && <p className="text-xs text-rose-600">{error}</p>}

            {ledger.cplSource !== "meta" && (
              <div className={cn("rounded-md border p-3", ledger.cplSource === "none" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50")}>
                <p className={cn("mb-2 flex items-start gap-1.5 text-xs", ledger.cplSource === "none" ? "text-amber-800" : "text-muted-foreground")}>
                  {ledger.cplSource === "none" ? (
                    <><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> No cost per lead set yet, so the total shows $0. Set the rate you&apos;re billed to see what you owe.</>
                  ) : (
                    <><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Billed at {usd(ledger.cplCents ?? 0)} per lead. Change it here anytime.</>
                  )}
                </p>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input inputMode="decimal" value={cplInput} onChange={(e) => setCplInput(e.target.value)} placeholder={ledger.cplCents != null ? (ledger.cplCents / 100).toFixed(2) : "cost per lead"} className="h-9 w-full rounded-md border border-slate-200 pl-6 pr-3 text-sm outline-none focus:border-brand-red" aria-label="Cost per lead" />
                  </div>
                  <Button variant="outline" onClick={saveCpl} disabled={cplSaving}>
                    {cplSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set rate"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Breakdown + payments */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{ledger.lockInActive ? "Lock-in leads so far" : "Leads since Nov 9"}</CardTitle>
            <CardDescription>Every fresh lead delivered to you or your team since the lock-in began{ledger.cplCents !== null ? `, at ${usd(ledger.cplCents)} each` : ""}. Leads sold to outside buyers and clients&apos; own campaign leads aren&apos;t included.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-1.5 text-sm">
              {([
                ["Your CRM", `${ledger.leadsToHouse} leads`, ""],
                ["Your team", `${ledger.leadsToTeam} leads`, ""],
                ["Total fronted", `${ledger.totalLeads} leads`, "font-medium border-t border-slate-100 pt-1.5"],
                ["Cost per lead", ledger.cplCents !== null ? usd(ledger.cplCents) : "—", "text-muted-foreground"],
                ["Total lead cost", usd(ledger.owedCents), "font-semibold"],
                ["Paid back", `− ${usd(ledger.paidCents)}`, "text-muted-foreground"],
                [owes ? "Still owed" : "Credit", owes ? usd(-ledger.balanceCents) : usd(ledger.balanceCents), cn("font-semibold border-t border-slate-100 pt-1.5", owes && "text-rose-600")],
              ] as [string, string, string][]).map(([label, value, clsName]) => (
                <div key={label} className={cn("flex justify-between gap-4", clsName)}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            {ledger.team.length > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs text-muted-foreground">Leads given to your team</p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">Agent</th>
                      <th className="py-1.5 text-right font-medium">Leads</th>
                      <th className="py-1.5 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.team.map((t) => (
                      <tr key={t.userId} className="border-t border-slate-100">
                        <td className="py-1.5">{t.name}</td>
                        <td className="py-1.5 text-right">{t.leads}</td>
                        <td className="py-1.5 text-right">{ledger.cplCents !== null ? usd(t.leads * ledger.cplCents) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {ledger.payments.length > 0 && (
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
            )}
          </CardContent>
        </Card>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Enhanced Wealth is fronting the ad cost for these leads. The total is the leads delivered to you and your team since the lock-in began, at the current blended cost per lead. Record each bank transfer you send and your balance updates — no receipts or verification needed.
        </span>
      </p>
    </div>
  );
}
