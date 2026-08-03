"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { findPackage } from "@/data/packages";

export interface CartItem {
  packageId: string;
  quantity: number;
}

interface CartContextValue {
  items: CartItem[];
  hydrated: boolean;
  addItem: (packageId: string, quantity: number) => void;
  setQuantity: (packageId: string, quantity: number) => void;
  removeItem: (packageId: string) => void;
  clear: () => void;
  count: number; // total leads across the cart
  lineCount: number; // distinct line items
  subtotalCents: number;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "advertisely_cart_v1";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load once on mount (client only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed.filter((i) => i && i.packageId && i.quantity > 0));
      }
    } catch {
      /* ignore corrupt storage */
    }
    setHydrated(true);
  }, []);

  // Persist on change (after hydration so we don't clobber saved cart with []).
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* ignore quota errors */
    }
  }, [items, hydrated]);

  const addItem = useCallback((packageId: string, quantity: number) => {
    if (quantity <= 0) return;
    setItems((prev) => {
      const existing = prev.find((i) => i.packageId === packageId);
      if (existing) {
        return prev.map((i) => (i.packageId === packageId ? { ...i, quantity: i.quantity + quantity } : i));
      }
      return [...prev, { packageId, quantity }];
    });
  }, []);

  const setQuantity = useCallback((packageId: string, quantity: number) => {
    setItems((prev) =>
      prev
        .map((i) => (i.packageId === packageId ? { ...i, quantity } : i))
        .filter((i) => i.quantity > 0),
    );
  }, []);

  const removeItem = useCallback((packageId: string) => {
    setItems((prev) => prev.filter((i) => i.packageId !== packageId));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const count = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotalCents = items.reduce((sum, i) => {
    const pkg = findPackage(i.packageId);
    return sum + (pkg ? Math.round(pkg.pricePerLead * 100) * i.quantity : 0);
  }, 0);

  return (
    <CartContext.Provider
      value={{ items, hydrated, addItem, setQuantity, removeItem, clear, count, lineCount: items.length, subtotalCents }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
