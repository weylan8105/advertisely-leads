"use client";

import { Wallet, TrendingUp, Users, Target, AlertTriangle, PauseCircle, Info, CalendarClock, BadgeCheck } from "lucide-react";
import { DashboardStatCard } from "@/components/dashboard/DashboardStatCard";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AdSpendSummary } from "@/lib/adSpend";
import { adSpendProgress } from "@/lib/adSpendProgress";
import { AddSpendForm } from "@/components/dashboard/AddSpendForm";

const METHOD_LABEL: Record<string, string> = { card: "Card", zelle: "Zelle", check: "Check", wire: "Wire", cash: "Cash", other: "Other", team: "Team", program: "Advertiser Program", "team-fee": "Management fee (20%)" };

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
  const low = summary.balanceCents <= 0;
  const runningLow = !low && summary.daysLeft !== null && summary.daysLeft <= 3;
  // Someone who has to join (or rejoin) the Advertiser Program can't add ad spend until they do.
  const viaProgram = summary.program.mustJoin;
  const member = summary.program.member;
  // Enhanced Wealth team: the $500 program membership is waived for them (older cached summaries lack these).
  const waiverTeam = !!summary.program.feeWaiverTeam;
  const feeWaived = !!summary.program.feeWaived;

  return (
    <div className="mb-6 space-y-4">
      {summary.program.mustJoin && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Your leads are paused.{" "}
            {summary.program.waiverEnded
              ? "Your membership fee was waived while you were on the Enhanced Wealth team, and you've left the team"
              : summary.program.legacyViaTeam
              ? "Your upline's advertiser month has ended"
              : summary.program.legacyUntil
                ? "Your November advertiser fee has run its month"
                : summary.program.joined
                  ? "Your program membership has ended"
                  : "You're no longer covered by a team's advertiser month"}
            , and advertiser leads now come through the{" "}
            <a href="/marketplace?tab=advertise" className="font-semibold underline">Advertisely Advertiser Program</a>.
          </span>
        </div>
      )}
      {!summary.program.joined && !summary.program.mustJoin && summary.program.legacyUntil && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {summary.program.legacyViaTeam ? "Your upline's advertiser month covers you until" : "Your November advertiser fee covers you until"}{" "}
            <strong>{new Date(summary.program.legacyUntil).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" })}</strong>.
            From then on, leads come through the{" "}
            <a href="/marketplace?tab=advertise" className="font-semibold underline">Advertisely Advertiser Program</a>{" "}
            {waiverTeam ? "(membership waived for the Enhanced Wealth team)" : "($500 every 2 weeks)"}.
          </span>
        </div>
      )}
      {feeWaived && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            <strong>Enhanced Wealth team: membership fee waived.</strong> Advertisers pay $500 every 2 weeks to be in the
            Advertiser Program. As part of the Enhanced Wealth team, you pay $0.
          </span>
        </div>
      )}
      {!summary.program.mustJoin && (low || runningLow || summary.pausedForBudget) && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
            low || summary.pausedForBudget ? "border-rose-200 bg-rose-50 text-rose-800" : "border-amber-200 bg-amber-50 text-amber-800",
          )}
        >
          {summary.pausedForBudget ? <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {viaProgram
              ? low || summary.pausedForBudget
                ? "Your balance is used up. Your next Advertiser Program payment adds to it, and leads pick back up."
                : "Your balance is running low. Your next Advertiser Program payment adds to it."
              : summary.pausedForBudget
              ? "Your campaign is paused because your budget is used up. Add spend below and it turns back on automatically."
              : low
                ? summary.sharedPoolOnly
                  ? "Your budget is used up. Add spend below to keep getting leads."
                  : "Your budget is used up. Add spend below to keep your campaign running."
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
          hint={summary.serviceFeeCents ? `Includes ${usd(summary.serviceFeeCents)} service fee` : summary.sharedPoolOnly ? "The cost of your leads" : "What Meta has spent"}
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
        {viaProgram ? (
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Advertiser Program</CardTitle>
            <CardDescription>
              {waiverTeam
                ? summary.program.joined
                  ? "Your membership has ended, so your leads are paused. Rejoin free: the $500 membership is waived for the Enhanced Wealth team. Your unused ad spend is still here."
                  : "Join free to get leads: the $500 membership is waived for the Enhanced Wealth team. Ad spend is separate and is added here once you're a member."
                : summary.program.joined
                  ? "Your membership has ended, so your leads are paused. Rejoin for $500 every 2 weeks; your unused ad spend is still here."
                  : "Join for $500 every 2 weeks to get leads. Ad spend is separate and is added here once you're a member."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <a href="/marketplace?tab=advertise">
              <Button>{summary.program.joined ? (waiverTeam ? "Rejoin free" : "Rejoin the program") : waiverTeam ? "Join free" : "Join the program"}</Button>
            </a>
          </CardContent>
        </Card>
        ) : (
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Add spend</CardTitle>
            <CardDescription>
              {member
                ? feeWaived
                  ? "Buys your leads. Your program membership is waived (Enhanced Wealth team)."
                  : "Buys your leads. Separate from your $500 program membership."
                : summary.sharedPoolOnly ? "Adds to your lead budget." : "Adds to your campaign budget."}{" "}
              Paid securely through Stripe.
              {member && <> <a href="/marketplace?tab=advertise" className="underline">Manage membership</a></>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AddSpendForm member={!!member} />
          </CardContent>
        </Card>
        )}

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
                  {summary.teamDirectCents > 0 && (
                    <>
                      {" "}{usd(summary.teamDirectCents)} of your own payments came from members who paid you directly
                      {summary.ownPaidCents > summary.teamDirectCents && <>, so {usd(summary.ownPaidCents - summary.teamDirectCents)} is yours</>}.
                    </>
                  )}
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
                          {f.movedOutCents > 0 ? (
                            <span className="ml-1 text-xs text-muted-foreground">(now an advertiser; {usd(f.movedOutCents)} moved to their own account)</span>
                          ) : (
                            !f.access && <span className="ml-1 text-xs text-muted-foreground">(switched off)</span>
                          )}
                        </td>
                        <td className="py-1.5 text-right">
                          {usd(f.addedCents)}
                          {f.directCents > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              {f.directCents === f.addedCents ? "paid you directly" : `${usd(f.directCents)} paid you directly`}
                            </span>
                          )}
                        </td>
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
