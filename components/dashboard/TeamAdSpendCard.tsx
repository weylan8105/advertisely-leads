"use client";

import { useEffect, useState } from "react";
import { Loader2, Megaphone } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TeamCampaign {
  advertiserId: string;
  advertiserName: string;
  creditCents: number;
  addedCents: number;
  directCents: number; // paid to the upline directly, not on the site
  access: boolean; // upline has spend switched on for them
  leads: number;
  leadCostCents: number;
  cplCents: number | null;
  leadsLeft: number | null;
}

const PRESETS = [250, 500, 1000, 2500];
const MIN_DOLLARS = 100;
const PROCESSING_RATE = 0.03; // lib/adSpend.ts PROCESSING_FEE_RATE

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * A downline's card for adding spend to their advertiser upline's campaign
 * (lib/teamAdSpend.ts). Shows when an upline has switched it on for them, or
 * (read-only) when they've already paid into that campaign.
 */
export function TeamAdSpendCard() {
  const [campaigns, setCampaigns] = useState<TeamCampaign[] | null>(null);

  useEffect(() => {
    fetch("/api/team/ad-spend")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCampaigns(d?.campaigns ?? []))
      .catch(() => setCampaigns([]));
  }, []);

  if (!campaigns?.length) return null;
  return (
    <div className="mb-6 space-y-4">
      {campaigns.map((c) => (
        <CampaignCard key={c.advertiserId} c={c} />
      ))}
    </div>
  );
}

function CampaignCard({ c }: { c: TeamCampaign }) {
  const [amount, setAmount] = useState("500");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typedCents = Math.round((Number(amount.replace(/[^0-9.]/g, "")) || 0) * 100);
  const netCents = typedCents - Math.round(typedCents * PROCESSING_RATE);

  async function addSpend() {
    const dollars = Number(amount.replace(/[^0-9.]/g, ""));
    if (!dollars || dollars < MIN_DOLLARS) {
      setError(`The minimum is $${MIN_DOLLARS}.`);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/team/ad-spend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ advertiserId: c.advertiserId, amountCents: Math.round(dollars * 100) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout.");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  }

  const out = c.cplCents !== null && c.creditCents < c.cplCents;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-sky-600" /> {c.advertiserName}&apos;s campaign
        </CardTitle>
        <CardDescription>
          Add spend to your upline&apos;s campaign and get its leads in your licensed states. Leads rotate between your upline
          and everyone who added spend; each one takes the campaign&apos;s cost per lead from your credit.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border border-slate-200 p-3">
            <dt className="text-xs text-muted-foreground">Your credit</dt>
            <dd className={cn("text-lg font-semibold tabular-nums", out && "text-amber-600")}>{usd(c.creditCents)}</dd>
            <dd className="text-xs text-muted-foreground">
              {c.leadsLeft !== null ? `≈ ${c.leadsLeft} lead${c.leadsLeft === 1 ? "" : "s"} left` : "Cost per lead not known yet"}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <dt className="text-xs text-muted-foreground">Cost per lead now</dt>
            <dd className="text-lg font-semibold tabular-nums">{c.cplCents !== null ? usd(c.cplCents) : "—"}</dd>
            <dd className="text-xs text-muted-foreground">The campaign&apos;s own cost per lead</dd>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <dt className="text-xs text-muted-foreground">Leads received</dt>
            <dd className="text-lg font-semibold tabular-nums">{c.leads}</dd>
            <dd className="text-xs text-muted-foreground">{c.leads ? `${usd(c.leadCostCents)} of credit used` : "From this campaign"}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 p-3">
            <dt className="text-xs text-muted-foreground">You&apos;ve added</dt>
            <dd className="text-lg font-semibold tabular-nums">{usd0(c.addedCents)}</dd>
            <dd className="text-xs text-muted-foreground">
              {c.directCents > 0
                ? c.directCents === c.addedCents
                  ? `Paid to ${c.advertiserName} directly`
                  : `Incl. ${usd0(c.directCents)} paid to ${c.advertiserName} directly`
                : "Before the 3% card fee"}
            </dd>
          </div>
        </dl>

        {!c.access ? (
          <p className="self-start rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-muted-foreground">
            {c.advertiserName} hasn&apos;t switched on campaign spend for you yet, so campaign leads aren&apos;t taken from
            your credit right now. Ask them to turn it on from their Team page.
          </p>
        ) : (
        <div className="space-y-3">
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
              {usd(typedCents)} adds {usd(netCents)} of credit after the 3% card fee
              {c.cplCents ? `, about ${Math.floor(netCents / c.cplCents)} leads at today's cost per lead` : ""}.
            </p>
          )}
          {error && <p className="text-xs text-rose-600">{error}</p>}
        </div>
        )}
      </CardContent>
    </Card>
  );
}
