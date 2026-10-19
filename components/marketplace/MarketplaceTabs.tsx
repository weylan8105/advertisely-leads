"use client";

import { useState } from "react";
import { ShoppingBag, Repeat } from "lucide-react";
import { MarketplaceStore } from "@/components/marketplace/MarketplaceStore";
import { SubscriptionPanel } from "@/components/marketplace/SubscriptionPanel";
import { cn } from "@/lib/utils";

export function MarketplaceTabs() {
  const [tab, setTab] = useState<"buy" | "subscribe">(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "subscribe") {
      return "subscribe";
    }
    return "buy";
  });

  return (
    <div>
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        <button
          onClick={() => setTab("buy")}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "buy" ? "bg-brand-red text-white" : "text-muted-foreground hover:text-foreground")}
        >
          <ShoppingBag className="h-3.5 w-3.5" /> Buy leads
        </button>
        <button
          onClick={() => setTab("subscribe")}
          className={cn("inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            tab === "subscribe" ? "bg-brand-red text-white" : "text-muted-foreground hover:text-foreground")}
        >
          <Repeat className="h-3.5 w-3.5" /> Subscribe &amp; Save
        </button>
      </div>

      {tab === "buy" ? (
        <>
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-800">
            <span className="font-medium">Heads up: </span>
            <strong>Fresh IUL leads</strong> — under 48 hours old. Buy from in-stock inventory by state, or any
            states without stock are delivered fresh as they&apos;re generated. Every order is a 25-lead minimum.
            Or switch to <strong>Subscribe &amp; Save</strong> for a steady weekly flow on autopilot.
          </div>
          <MarketplaceStore />
        </>
      ) : (
        <SubscriptionPanel />
      )}
    </div>
  );
}
