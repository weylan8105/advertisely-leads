"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, Lock, Bell, Clock, Plus, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { tiersForGroup } from "@/data/packages";
import { useCart } from "@/context/CartContext";
import { formatCurrency, cn } from "@/lib/utils";
import type { ProductGroup } from "@/types";

export function ProductGroupCard({ group, onAdded }: { group: ProductGroup; onAdded?: () => void }) {
  const tiers = useMemo(() => tiersForGroup(group.id), [group.id]);
  const { addItem } = useCart();

  const firstAvailable = tiers.find((t) => t.available !== false) ?? tiers[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(firstAvailable?.id);
  const selected = tiers.find((t) => t.id === selectedId) ?? firstAvailable;
  const [qty, setQty] = useState(firstAvailable?.minimumOrder ?? 25);
  const [justAdded, setJustAdded] = useState(false);

  // Live availability, refreshed on an interval so counts stay current.
  const [avail, setAvail] = useState<Record<string, number>>({});
  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/inventory")
        .then((r) => r.json())
        .then((d) => {
          if (active) setAvail(d.tiers ?? {});
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  function selectTier(id: string) {
    const t = tiers.find((x) => x.id === id);
    if (!t || t.available === false) return; // can't select an unavailable tier
    setSelectedId(id);
    setQty(t.minimumOrder); // reset to the new tier's minimum
  }

  function changeQty(next: number) {
    const min = selected?.minimumOrder ?? 25;
    setQty(Math.max(min, Math.round(next) || min));
  }

  function add() {
    if (!selected) return;
    addItem(selected.id, qty);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
    onAdded?.();
  }

  const headlinePrice = tiers[0]?.pricePerLead; // freshest tier ($45)
  const lowestPrice = tiers.length ? Math.min(...tiers.map((t) => t.pricePerLead)) : undefined;

  // ── Coming-soon group (e.g. Term) ──
  if (!group.available || tiers.length === 0) {
    return (
      <Card className="relative flex flex-col overflow-hidden opacity-90">
        <div className="absolute top-4 right-4 z-10">
          <Badge variant="muted">
            <Lock className="h-3 w-3 mr-1" /> Coming soon
          </Badge>
        </div>
        <div className="p-6 flex-1 flex flex-col">
          <h3 className="text-lg font-semibold tracking-tight pr-28">{group.name}</h3>
          <p className="text-xs text-brand-red mt-1">{group.tagline}</p>
          <p className="mt-3 text-sm text-muted-foreground flex-1">{group.blurb}</p>
          {group.comingSoonNote && (
            <div className="mt-5 rounded-md border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[11px] text-amber-800">
              <span className="font-medium">Coming soon — </span>
              {group.comingSoonNote}
            </div>
          )}
          <div className="mt-6">
            <Button variant="outline" size="sm" disabled>
              <Bell className="h-3.5 w-3.5" /> Notify me
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative flex flex-col overflow-hidden ring-1 ring-brand-red/30 shadow-[0_24px_80px_-16px_rgba(220,38,38,0.18)]">
      <div className="absolute top-4 right-4 z-10">
        <Badge variant="success">
          <Sparkles className="h-3 w-3 mr-1" /> Available now
        </Badge>
      </div>
      <div className="p-6 flex-1 flex flex-col">
        <h3 className="text-lg font-semibold tracking-tight pr-28">{group.name}</h3>
        <p className="text-xs text-brand-red mt-1">{group.tagline}</p>
        <p className="mt-3 text-sm text-muted-foreground">{group.blurb}</p>

        <div className="mt-4 flex items-baseline gap-2">
          <span className="text-3xl font-semibold tracking-tight">{formatCurrency(headlinePrice ?? 0)}</span>
          <span className="text-xs text-muted-foreground">/ lead</span>
          {lowestPrice !== undefined && lowestPrice !== headlinePrice && (
            <span className="text-xs text-muted-foreground">· down to {formatCurrency(lowestPrice)} aged</span>
          )}
        </div>

        {/* Age subcategories */}
        <div className="mt-4 text-[11px] uppercase tracking-wide text-muted-foreground">Choose lead age</div>
        <div className="mt-2 space-y-1.5">
          {tiers.map((t) => {
            const active = t.id === selected?.id;
            const disabled = t.available === false;
            const count = avail[t.id];
            return (
              <button
                key={t.id}
                onClick={() => selectTier(t.id)}
                disabled={disabled}
                className={cn(
                  "w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left transition-colors",
                  disabled
                    ? "border-slate-200 bg-slate-50 opacity-70 cursor-not-allowed"
                    : active
                      ? "border-brand-red/50 bg-brand-red/[0.05]"
                      : "border-slate-200 bg-white hover:border-slate-300",
                )}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {!disabled && (
                    <span
                      className={cn(
                        "h-4 w-4 rounded-full border grid place-items-center shrink-0",
                        active ? "border-brand-red bg-brand-red text-white" : "border-slate-300",
                      )}
                    >
                      {active && <Check className="h-2.5 w-2.5" />}
                    </span>
                  )}
                  <span className="text-sm truncate">
                    {t.name.replace(/^Fresh IUL — /, "").replace(/^IUL — /, "")}
                    {disabled ? (
                      <span className="ml-2 text-[10px] text-amber-600">
                        {t.comingSoonNote ?? "Temporarily unavailable"}
                      </span>
                    ) : count != null ? (
                      <span
                        className={cn(
                          "ml-2 text-[10px]",
                          count > 0 ? "text-emerald-600" : "text-muted-foreground",
                        )}
                      >
                        {count > 0 ? `${count} available` : "0 available"}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span
                  className={cn(
                    "text-sm font-semibold shrink-0",
                    disabled && "text-muted-foreground line-through",
                  )}
                >
                  {formatCurrency(t.pricePerLead)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Quantity + add */}
        <div className="mt-5 flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] text-muted-foreground mb-1">
              Quantity <span className="text-muted-foreground/70">(min {selected?.minimumOrder})</span>
            </div>
            <div className="inline-flex items-center rounded-lg border border-slate-200">
              <button
                onClick={() => changeQty(qty - 25)}
                className="h-9 w-9 grid place-items-center text-muted-foreground hover:text-foreground"
                aria-label="Decrease"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                value={qty}
                min={selected?.minimumOrder}
                onChange={(e) => changeQty(parseInt(e.target.value))}
                className="h-9 w-16 text-center text-sm border-x border-slate-200 outline-none"
              />
              <button
                onClick={() => changeQty(qty + 25)}
                className="h-9 w-9 grid place-items-center text-muted-foreground hover:text-foreground"
                aria-label="Increase"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-muted-foreground">Line total</div>
            <div className="text-lg font-semibold">{formatCurrency((selected?.pricePerLead ?? 0) * qty)}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {selected?.estimatedDelivery}
        </div>

        <Button className="mt-5 w-full" onClick={add}>
          {justAdded ? (
            <>
              <Check className="h-4 w-4" /> Added to cart
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" /> Add to cart
            </>
          )}
        </Button>
      </div>
    </Card>
  );
}
