"use client";

import { useState } from "react";
import { ShoppingCart } from "lucide-react";
import { ProductGroupCard } from "@/components/marketplace/ProductGroupCard";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { productGroups } from "@/data/packages";
import { useCart } from "@/context/CartContext";
import { formatCurrency } from "@/lib/utils";

export function MarketplaceStore() {
  const [cartOpen, setCartOpen] = useState(false);
  const { count, subtotalCents, hydrated } = useCart();

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-muted-foreground">
          Showing <span className="text-foreground font-medium">{productGroups.length}</span> product lines
        </div>
        <button
          onClick={() => setCartOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm hover:border-slate-300"
        >
          <ShoppingCart className="h-4 w-4" />
          Cart
          {hydrated && count > 0 && (
            <span className="ml-1 inline-grid place-items-center min-w-5 h-5 px-1 rounded-full bg-brand-red text-white text-[11px] font-semibold">
              {count}
            </span>
          )}
        </button>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {productGroups.map((g) => (
          <ProductGroupCard key={g.id} group={g} onAdded={() => setCartOpen(true)} />
        ))}
      </div>

      {/* Floating cart button (mobile-friendly, appears once there's something in it) */}
      {hydrated && count > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-full bg-brand-red text-white px-5 py-3 shadow-lg hover:brightness-110"
        >
          <ShoppingCart className="h-5 w-5" />
          <span className="font-semibold">{count} leads</span>
          <span className="opacity-90">·</span>
          <span>{formatCurrency(subtotalCents / 100)}</span>
        </button>
      )}

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </>
  );
}
