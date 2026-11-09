"use client";

import { useState } from "react";
import { Wallet, TrendingUp, Users, Target, Loader2, AlertTriangle, PauseCircle, Info } from "lucide-react";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdSpendSummary } from "@/lib/adSpend";

const PRESETS = [500, 1000, 2500, 5000];
const MIN_DOLLARS = 100;

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** An advertiser's campaign budget: what they've paid, spent, have left, and what leads cost. */
export function AdvertiserSpendPanel({ summary }: { summary: AdSpendSummary }) {
  const [amount, setAmount] = useState("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const low = summary.balanceCents <= 0;
  const runningLow = !low && summary.daysLeft !== null && summary.daysLeft <= 3;

  async function addSpend() {
    const dollars = Number(amount.replace(/[^0-9.]/g, ""));
    if (!dollars || dollars < MIN_DOLLARS) {
      setError(`The minimum is $${MIN_DOLLARS}.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/advertiser/spend/top-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountCents: Math.round(dollars * 100) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  return (
    <div className="mb-6 space-y-4">
      {(low || runningLow || summary.pausedForBudget) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
            low || summary.pausedForBudget ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {summary.pausedForBudget ? <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {summary.pausedForBudget
              ? "Your campaign is paused because your budget is used up. Add spend below and it turns back on automatically."
              : low
                ? "Your budget is used up. Add spend below to keep your campaign running."
                : `About ${summary.daysLeft} day${summary.daysLeft === 1 ? "" : "s"} of budget left at your current daily budget. Add spend to keep your campaign running.`}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <DashboardStatCard
          label="Budget left"
          value={usd(summary.balanceCents)}
          hint={summary.daysLeft !== null ? `≈ ${summary.daysLeft} day${summary.daysLeft === 1 ? "" : "s"} at ${usd0(summary.dailyBudgetCents ?? 0)}/day` : "Paid minus campaign spend"}
          icon={<Wallet className="h-4 w-4" />}
          accent={low ? "amber" : "emerald"}
        />
        <DashboardStatCard
          label="Total added"
          value={usd(summary.paidCents)}
          hint={`${summary.payments.length} payment${summary.payments.length === 1 ? "" : "s"}`}
          icon={<Wallet className="h-4 w-4" />}
          accent="blue"
        />
        <DashboardStatCard
          label="Campaign spend"
          value={usd(summary.chargedCents)}
          hint="Includes 3% card processing"
          icon={<TrendingUp className="h-4 w-4" />}
          accent="teal"
        />
        <DashboardStatCard
          label="Leads"
          value={summary.leads}
          hint={`${summary.leadsThisMonth} this month`}
          icon={<Users className="h-4 w-4" />}
          accent="violet"
        />
        <DashboardStatCard
          label="Cost per lead"
          value={summary.costPerLeadCents !== null ? usd(summary.costPerLeadCents) : "—"}
          hint="Spend incl. 3% ÷ leads"
          icon={<Target className="h-4 w-4" />}
          accent="amber"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Add spend</CardTitle>
            <CardDescription>Adds to your campaign budget. Paid securely through Stripe.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(String(p))}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm",
                    Number(amount) === p ? "border-brand-red bg-brand-red/10 text-brand-red" : "border-slate-200 hover:bg-slate-50",
                  )}
                >
                  {usd0(p * 100)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-200 pl-6 pr-3 text-sm outline-none focus:border-brand-red"
                  aria-label="Amount to add"
                />
              </div>
              <Button onClick={addSpend} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add spend"}
              </Button>
            </div>
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Spend by month</CardTitle>
            <CardDescription>What your campaign spent, and what that came to with fees.</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.months.length === 0 ? (
              <p className="text-sm text-muted-foreground">No spend yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">Month</th>
                      <th className="py-1.5 text-right font-medium">Ad spend</th>
                      <th className="py-1.5 text-right font-medium">3% card fee</th>
                      <th className="py-1.5 text-right font-medium">Service fee</th>
                      <th className="py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.months.map((m) => (
                      <tr key={m.month} className="border-t border-slate-100">
                        <td className="py-1.5">{monthLabel(m.month)}</td>
                        <td className="py-1.5 text-right">{usd(m.spendCents)}</td>
                        <td className="py-1.5 text-right">{usd(m.cardFeeCents)}</td>
                        <td className="py-1.5 text-right">{m.serviceFeeCents ? usd(m.serviceFeeCents) : "—"}</td>
                        <td className="py-1.5 text-right font-medium">{usd(m.chargedCents)}</td>
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
          Campaign spend includes a 3% card processing fee. Ad spend over $15,000 in a calendar month is subject to a 20%
          service fee, charged only on the amount over $15,000. Spend figures come from Meta and can lag by a few hours.
        </span>
      </p>
    </div>
  );
}
