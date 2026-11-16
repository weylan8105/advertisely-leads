"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, Repeat, Megaphone } from "lucide-react";
import { MarketplaceStore } from "@/components/marketplace/MarketplaceStore";
import { SubscriptionPanel } from "@/components/marketplace/SubscriptionPanel";
import { AdvertiserProgramPanel } from "@/components/marketplace/AdvertiserProgramPanel";
import { cn } from "@/lib/utils";

type Tab = "advertise" | "buy" | "subscribe";

// The Advertiser Program is the main way to get leads (owner, Nov 16 2026);
// buying leads outright is second. Subscribe & Save was replaced by the
// program: its tab only shows for someone who still has a subscription, so
// they can see and manage it.
export function MarketplaceTabs() {
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    return t === "buy" || t === "subscribe" ? t : "advertise";
  });
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/subscription", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setHasSubscription(!!d?.subscribed))
      .catch(() => setHasSubscription(false));
  }, []);
  // A link to the old tab from someone without a subscription lands on the program.
  useEffect(() => {
    if (tab === "subscribe" && hasSubscription === false) setTab("advertise");
  }, [tab, hasSubscription]);

  const tabButton = (id: Tab, label: React.ReactNode) => (
    <button
      onClick={() => setTab(id)}
      className={cn("inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
        tab === id ? "bg-brand-red text-white" : "text-muted-foreground hover:text-foreground")}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {tabButton("advertise", <><Megaphone className="h-3.5 w-3.5" /> Advertiser Program</>)}
        {tabButton("buy", <><ShoppingBag className="h-3.5 w-3.5" /> Buy leads</>)}
        {hasSubscription && tabButton("subscribe", <><Repeat className="h-3.5 w-3.5" /> My subscription</>)}
      </div>

      {tab === "buy" ? (
        <>
          <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-800">
            <span className="font-medium">Heads up: </span>
            <strong>Fresh IUL leads</strong> — under 48 hours old. Buy from in-stock inventory by state, or any
            states without stock are delivered fresh as they&apos;re generated. Every order is a 25-lead minimum.
            For leads at our cost, join the <strong>Advertiser Program</strong>.
          </div>
          <MarketplaceStore />
        </>
      ) : tab === "subscribe" ? (
        hasSubscription === false ? <AdvertiserProgramPanel /> : <SubscriptionPanel />
      ) : (
        <AdvertiserProgramPanel />
      )}
    </div>
  );
}
