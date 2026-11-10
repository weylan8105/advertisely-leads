"use client";

import { useEffect, useState } from "react";
import { Banknote, Loader2, X, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LeadCostLedger } from "@/lib/leadCostLedger";

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dateLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

/** The Chicago weekday index (Sun=0 … Sat=6). */
function chicagoDow(now = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(now);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

/**
 * A once-a-week nudge in Ryan's pipeline to pay for last week's leads. Shows
 * Tuesday through Sunday while he still owes for leads from the completed week,
 * and stays dismissed for that week once he closes it or records a payment.
 */
export function LeadCostReminderModal({ enabled }: { enabled: boolean }) {
  const [ledger, setLedger] = useState<LeadCostLedger | null>(null);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    fetch("/api/admin/lead-cost")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const l: LeadCostLedger | null = d?.ledger ?? null;
        if (!l) return;
        setLedger(l);
        const dow = chicagoDow();
        const isTueThroughSun = dow === 0 || dow >= 2; // every day except Monday
        const owesForLastWeek = l.lastWeek.leads > 0 && l.balanceCents < 0;
        const key = `lead-cost-reminder-dismissed:${l.lastWeek.startIso.slice(0, 10)}`;
        let dismissed = false;
        try {
          dismissed = localStorage.getItem(key) === "1";
        } catch {}
        if (isTueThroughSun && owesForLastWeek && !dismissed) setOpen(true);
      })
      .catch(() => {});
  }, [enabled]);

  if (!enabled || !open || !ledger) return null;

  const dismissKey = `lead-cost-reminder-dismissed:${ledger.lastWeek.startIso.slice(0, 10)}`;
  function dismiss() {
    try {
      localStorage.setItem(dismissKey, "1");
    } catch {}
    setOpen(false);
  }

  const owed = -ledger.balanceCents; // positive when he owes
  const suggested = ledger.lastWeek.owedCents > 0 ? ledger.lastWeek.owedCents : owed;

  async function recordPayment() {
    const dollars = Number((amount || String(suggested / 100)).replace(/[^0-9.\-]/g, ""));
    if (!dollars) {
      setError("Enter the amount you paid.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/lead-cost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: Math.round(dollars * 100), note: "Weekly lead-cost bank transfer" }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not record the payment.");
      setDone(true);
      try {
        localStorage.setItem(dismissKey, "1");
      } catch {}
      setTimeout(() => setOpen(false), 1400);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Pay for last week's leads">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-slate-100 p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-red/10 text-brand-red">
              <Banknote className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Pay for last week&apos;s leads</h2>
              <p className="text-xs text-muted-foreground">{dateLabel(ledger.lastWeek.startIso)} – {dateLabel(ledger.lastWeek.endIso)}</p>
            </div>
          </div>
          <button onClick={dismiss} className="text-muted-foreground hover:text-slate-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-medium">Payment recorded. Thanks, Ryan.</p>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <p className="text-sm text-muted-foreground">
              It&apos;s Tuesday — time to settle up with Advertisely for the Enhanced Wealth leads from last week.
            </p>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground">Last week&apos;s leads</span>
                <span className="font-medium">{ledger.lastWeek.leads}{ledger.cplCents !== null ? ` × ${usd(ledger.cplCents)}` : ""}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground">Last week&apos;s cost</span>
                <span className="font-semibold">{usd(ledger.lastWeek.owedCents)}</span>
              </div>
              {owed !== ledger.lastWeek.owedCents && (
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1.5">
                  <span className="text-muted-foreground">Total still owed</span>
                  <span className="font-semibold text-rose-600">{usd(owed)}</span>
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Amount you paid by bank transfer</label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(suggested / 100).toFixed(2)} className="h-9 w-full rounded-md border border-slate-200 pl-6 pr-3 text-sm outline-none focus:border-brand-red" aria-label="Amount paid" />
                </div>
                <Button onClick={recordPayment} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Record payment"}
                </Button>
              </div>
              {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
            </div>
            <div className="flex items-center justify-between">
              <button onClick={dismiss} className="text-xs text-muted-foreground hover:text-slate-700">Remind me later</button>
              <span className="text-xs text-muted-foreground">We trust the amount — no receipt needed.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
