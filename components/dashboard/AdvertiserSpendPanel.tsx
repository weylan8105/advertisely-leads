"use client";

import { useState } from "react";
import { Wallet, TrendingUp, Users, Target, Loader2, AlertTriangle, PauseCircle, Info, CalendarClock } from "lucide-react";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdSpendSummary } from "@/lib/adSpend";
import { adSpendProgress } from "@/lib/adSpendProgress";

const PRESETS = [500, 1000, 2500, 5000];
const MIN_DOLLARS = 100;
const PROCESSING_RATE = 0.03; // lib/adSpend.ts PROCESSING_FEE_RATE
const METHOD_LABEL: Record<string, string> = { card: "Card", zelle: "Zelle", check: "Check", wire: "Wire", cash: "Cash", other: "Other", team: "Team" };

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function dayLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

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
  const typedCents = Math.round((Number(amount.replace(/[^0-9.]/g, "")) || 0) * 100);
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

      <AdSpendBar summary={summary} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <DashboardStatCard
          label="Budget left"
          value={usd(summary.balanceCents)}
          hint={summary.daysLeft !== null ? `≈ ${summary.daysLeft} day${summary.daysLeft === 1 ? "" : "s"} at ${usd0(summary.dailyBudgetCents ?? 0)}/day` : "Paid minus campaign spend"}
          icon={<Wallet className="h-4 w-4" />}
          accent={low ? "amber" : "emerald"}
        />
        <DashboardStatCard
          label="Available for ads"
          value={usd(summary.availableCents)}
          hint={summary.processingFeeCents ? `${usd0(summary.paidCents)} added − card processing` : `${usd0(summary.paidCents)} added`}
          icon={<Wallet className="h-4 w-4" />}
          accent="blue"
        />
        <DashboardStatCard
          label="Ad spend"
          value={usd(summary.chargedCents)}
          hint={summary.serviceFeeCents ? `Includes ${usd(summary.serviceFeeCents)} service fee` : "What Meta has spent"}
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
          hint="Ad spend ÷ leads"
          icon={<Target className="h-4 w-4" />}
          accent="amber"
        />
      </div>

      {summary.autoPause && summary.pacedDailyCents !== null && !low && (
        <div className="flex items-start gap-2 rounded-lg border border-slate-200 px-4 py-3 text-sm">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-brand-red" />
          <span>
            {summary.periods.some((p) => Date.parse(p.endsAt) > Date.now()) ? (
              <>
                Each payment you add is spent over the 7 days after it&apos;s made (your latest runs through{" "}
                <strong>
                  {new Date(Math.max(...summary.periods.map((p) => Date.parse(p.endsAt)))).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}
                </strong>
                ). That&apos;s about <strong>{usd0(summary.pacedDailyCents)}/day</strong>. Daily budgets are adjusted gradually so
                delivery stays steady, and your campaign never spends more than you&apos;ve added.
              </>
            ) : (
              <>
                We manage your campaign to use your budget by <strong>{dayLabel(summary.targetDate)}</strong>, at about{" "}
                <strong>{usd0(summary.pacedDailyCents)}/day</strong>. Daily budgets are adjusted gradually so delivery stays
                steady, and your campaign never spends more than you&apos;ve added.
              </>
            )}
          </span>
        </div>
      )}

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
            {typedCents >= MIN_DOLLARS * 100 && (
              <p className="text-xs text-muted-foreground">
                {usd(typedCents)} adds {usd(typedCents - Math.round(typedCents * PROCESSING_RATE))} to your ad budget after the
                3% card processing fee.
              </p>
            )}
            {error && <p className="text-xs text-rose-600">{error}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>How your budget is used</CardTitle>
            <CardDescription>Everything you&apos;ve added, and where it&apos;s gone.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-1.5 text-sm">
              {(
                [
                  ["Added", usd(summary.paidCents), ""],
                  ["Card processing (3% of card payments)", `− ${usd(summary.processingFeeCents)}`, "text-muted-foreground"],
                  ["Available for ads", usd(summary.availableCents), "font-medium border-t border-slate-100 pt-1.5"],
                  ["Ad spend", `− ${usd(summary.spendCents)}`, "text-muted-foreground"],
                  ...(summary.serviceFeeCents
                    ? [["Service fee (20% over $15k/mo)", `− ${usd(summary.serviceFeeCents)}`, "text-muted-foreground"]]
                    : []),
                  ["Budget left", usd(summary.balanceCents), cn("font-semibold border-t border-slate-100 pt-1.5", low && "text-rose-600")],
                ] as [string, string, string][]
              ).map(([label, value, cls]) => (
                <div key={label} className={cn("flex justify-between gap-4", cls)}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {summary.payments.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">Payment</th>
                      <th className="py-1.5 font-medium">Method</th>
                      <th className="py-1.5 text-right font-medium">Amount</th>
                      <th className="py-1.5 text-right font-medium">Processing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.payments.map((p) => (
                      <tr key={p.id} className="border-t border-slate-100">
                        <td className="py-1.5">{new Date(p.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</td>
                        <td className="py-1.5">{p.method === "team" ? p.description ?? "Team" : METHOD_LABEL[p.method] ?? p.method}</td>
                        <td className="py-1.5 text-right">{usd(p.amountCents)}</td>
                        <td className="py-1.5 text-right">{p.processingFeeCents ? `− ${usd(p.processingFeeCents)}` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(summary.teamFunding?.length ?? 0) > 0 && (
              <div className="overflow-x-auto">
                <p className="mb-1 text-xs text-muted-foreground">
                  Your team&apos;s spend: members you&apos;ve switched on add to this budget and get campaign leads in
                  rotation with you, each at the campaign&apos;s cost per lead.
                  {summary.teamCreditCents > 0 && <> Budget left includes {usd(summary.teamCreditCents)} of their unused credit.</>}
                </p>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">Member</th>
                      <th className="py-1.5 text-right font-medium">Added</th>
                      <th className="py-1.5 text-right font-medium">Leads</th>
                      <th className="py-1.5 text-right font-medium">Credit left</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.teamFunding.map((f) => (
                      <tr key={f.userId} className="border-t border-slate-100">
                        <td className="py-1.5">
                          {f.name}
                          {!f.access && <span className="ml-1 text-xs text-muted-foreground">(switched off)</span>}
                        </td>
                        <td className="py-1.5 text-right">{usd(f.addedCents)}</td>
                        <td className="py-1.5 text-right">{f.leads}</td>
                        <td className="py-1.5 text-right">{usd(Math.max(0, f.creditCents))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {summary.months.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted-foreground">
                      <th className="py-1.5 font-medium">Month</th>
                      <th className="py-1.5 text-right font-medium">Ad spend</th>
                      <th className="py-1.5 text-right font-medium">Service fee</th>
                      <th className="py-1.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.months.map((m) => (
                      <tr key={m.month} className="border-t border-slate-100">
                        <td className="py-1.5">{monthLabel(m.month)}</td>
                        <td className="py-1.5 text-right">{usd(m.spendCents)}</td>
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
          3% of each card payment covers card processing. That&apos;s Stripe&apos;s fee, passed through at cost; it
          isn&apos;t revenue for Advertisely. Payments sent by Zelle, check or wire have no processing fee. Ad spend over $15,000 in a calendar month is subject to a 20% service fee, charged only
          on the amount over $15,000. Spend figures come from Meta and can lag by a few hours.
        </span>
      </p>
    </div>
  );
}

/** At-a-glance progress through the budget: the same bar admins see for this account. */
function AdSpendBar({ summary }: { summary: AdSpendSummary }) {
  const { pct, out, low } = adSpendProgress(summary);
  const days = summary.daysLeft;
  return (
    <Card>
      <CardContent className="py-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="text-sm">
            <span className="font-semibold">{usd0(summary.chargedCents)}</span>
            <span className="text-muted-foreground"> spent of {usd0(summary.availableCents)} added</span>
          </span>
          <span
            className={cn(
              "text-sm tabular-nums",
              out ? "font-semibold text-rose-600" : low ? "font-semibold text-amber-600" : "text-muted-foreground",
            )}
          >
            {out
              ? "Budget used up"
              : `${usd0(summary.balanceCents)} left${
                  days !== null ? (days < 1 ? " · under 1 day" : ` · about ${days} day${days === 1 ? "" : "s"}`) : ""
                }`}
          </span>
        </div>
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-sky-100"
          role="progressbar"
          aria-label="Ad budget spent"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div
            className={cn("h-full rounded-full transition-all", out ? "bg-rose-500" : low ? "bg-amber-500" : "bg-sky-500")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {pct}% of your budget used
          {summary.costPerLeadCents !== null ? ` · ${usd(summary.costPerLeadCents)} per lead` : ""}
          {summary.pausedForBudget ? " · campaign paused" : ""}
        </div>
      </CardContent>
    </Card>
  );
}
