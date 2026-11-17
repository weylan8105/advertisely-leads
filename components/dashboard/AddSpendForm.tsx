"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PRESETS = [500, 1000, 2500, 5000];
const MIN_DOLLARS = 100; // lib/adSpend.ts MIN_TOP_UP_CENTS
const PROCESSING_RATE = 0.03; // lib/adSpend.ts PROCESSING_FEE_RATE

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Pick an amount and pay for ad spend through Stripe Checkout
 * (POST /api/advertiser/spend/top-up). Used on the advertiser's dashboard and,
 * for Advertiser Program members, on the marketplace's program tab.
 */
export function AddSpendForm({
  member,
  returnTo = "dashboard",
}: {
  /** An Advertiser Program member: the payment is credited in full, the card fee is on each lead. */
  member: boolean;
  /** Where Stripe sends them back to. */
  returnTo?: "dashboard" | "marketplace";
}) {
  const [amount, setAmount] = useState("1000");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const typedCents = Math.round((Number(amount.replace(/[^0-9.]/g, "")) || 0) * 100);

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
        body: JSON.stringify({ amountCents: Math.round(dollars * 100), returnTo }),
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
            onKeyDown={(e) => { if (e.key === "Enter" && !loading) addSpend(); }}
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
          {member ? (
            <>All {usd(typedCents)} goes to leads. Each lead costs our cost plus the 20% management fee and 3% card fee.</>
          ) : (
            <>
              {usd(typedCents)} adds {usd(typedCents - Math.round(typedCents * PROCESSING_RATE))} to your ad budget after the
              3% card processing fee.
            </>
          )}
        </p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
