"use client";

import { useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";

// The marketplace tab that's open, shared with the page header and footer
// (server-rendered around MarketplaceTabs). Replacements apply to leads you
// buy, not to the Advertiser Program (owner, Nov 16 2026), so the
// "Replacement-eligible" badge and the replacement disclaimer only show on the
// buying tabs.

export type MarketplaceTab = "advertise" | "buy" | "subscribe";

let current: MarketplaceTab | null = null;
const listeners = new Set<() => void>();

/** The tab a link asks for (?tab=…); the Advertiser Program by default. */
export function tabFromUrl(): MarketplaceTab {
  const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
  return t === "buy" || t === "subscribe" ? t : "advertise";
}

export function setMarketplaceTab(t: MarketplaceTab) {
  if (t === current) return;
  current = t;
  listeners.forEach((l) => l());
}

function useMarketplaceTab(): MarketplaceTab {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current ?? tabFromUrl(),
    () => "advertise",
  );
}

/** The header badges: "Replacement-eligible" only where leads are bought. */
export function MarketplaceHeaderBadges() {
  const tab = useMarketplaceTab();
  return (
    <div className="flex gap-2 flex-wrap">
      <Badge variant="success">Live inventory</Badge>
      {tab !== "advertise" && <Badge variant="muted">Replacement-eligible</Badge>}
    </div>
  );
}

/** The replacement line of the disclaimer, on the buying tabs only. */
export function ReplacementDisclaimer() {
  const tab = useMarketplaceTab();
  return tab === "advertise" ? null : <> Replacement eligibility subject to quality review.</>;
}
