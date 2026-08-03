"use client";

import Link from "next/link";
import { X, ShoppingCart, Trash2, Plus, Minus, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { findPackage } from "@/data/packages";
import { formatCurrency, cn } from "@/lib/utils";

export function CartDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, setQuantity, removeItem, subtotalCents, count } = useCart();

  return (
    <>
      {/* Scrim */}
      <div
        className={cn(
          "fixed inset-0 bg-slate-900/40 z-40 transition-opacity",
          open ? "opacity-100" : "opacity-0 pointer-events-none",
        )}
        onClick={onClose}
      />
      {/* Panel */}
      <aside
        className={cn(
          "fixed top-0 right-0 h-full w-full max-w-md bg-white z-50 shadow-xl flex flex-col transition-transform",
          open ? "translate-x-0" : "translate-x-full",
        )}
        role="dialog"
        aria-label="Cart"
      >
        <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-2 font-semibold">
            <ShoppingCart className="h-5 w-5 text-brand-red" /> Your cart
            {count > 0 && <span className="text-sm text-muted-foreground">({count} leads)</span>}
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3 scrollbar-thin">
          {items.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-16">
              <ShoppingCart className="h-8 w-8 mx-auto mb-3 text-slate-300" />
              Your cart is empty. Add lead tiers from the marketplace.
            </div>
          ) : (
            items.map((item) => {
              const pkg = findPackage(item.packageId);
              if (!pkg) return null;
              const min = pkg.minimumOrder;
              return (
                <div key={item.packageId} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{pkg.name}</div>
                      <div className="text-xs text-muted-foreground">{formatCurrency(pkg.pricePerLead)} / lead</div>
                    </div>
                    <button
                      onClick={() => removeItem(item.packageId)}
                      className="text-muted-foreground hover:text-rose-600"
                      aria-label="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="inline-flex items-center rounded-lg border border-slate-200">
                      <button
                        onClick={() => setQuantity(item.packageId, Math.max(min, item.quantity - 25))}
                        className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground"
                        aria-label="Decrease"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input
                        type="number"
                        value={item.quantity}
                        min={min}
                        onChange={(e) =>
                          setQuantity(item.packageId, Math.max(min, parseInt(e.target.value) || min))
                        }
                        className="h-8 w-14 text-center text-sm border-x border-slate-200 outline-none"
                      />
                      <button
                        onClick={() => setQuantity(item.packageId, item.quantity + 25)}
                        className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground"
                        aria-label="Increase"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="text-sm font-semibold">
                      {formatCurrency(pkg.pricePerLead * item.quantity)}
                    </div>
                  </div>
                  {item.quantity < min && (
                    <p className="mt-2 text-[11px] text-rose-600">Minimum {min} leads for this tier.</p>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="border-t border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Subtotal</span>
            <span className="text-lg font-semibold">{formatCurrency(subtotalCents / 100)}</span>
          </div>
          <Link href="/checkout" className="block" onClick={onClose}>
            <Button className="w-full" disabled={items.length === 0}>
              Checkout <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <p className="text-[10px] text-muted-foreground text-center">
            You&apos;ll pick your states and pay on the next step. One order is created per tier.
          </p>
        </div>
      </aside>
    </>
  );
}
