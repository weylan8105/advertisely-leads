"use client";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Trash2,
  Plus,
  Minus,
  ShoppingCart,
} from "lucide-react";
import { StripePaymentForm } from "@/components/checkout/StripePaymentForm";
import { CheckoutAuthPanel } from "@/components/checkout/CheckoutAuthPanel";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useCart } from "@/context/CartContext";
import { findPackage } from "@/data/packages";
import { formatCurrency, cn } from "@/lib/utils";
import type { LeadPackageId } from "@/types";

const ACTIVE_STATES = [
  { code: "TX" }, { code: "FL" }, { code: "CA" }, { code: "IL" }, { code: "PA" },
  { code: "OH" }, { code: "CO" }, { code: "MI" }, { code: "WA" },
];

const steps = [
  { id: 1, label: "Cart & filters" },
  { id: 2, label: "Payment" },
  { id: 3, label: "Confirmation" },
];

export function CheckoutFlow({ initialPackageId }: { initialPackageId?: LeadPackageId }) {
  const { status } = useSession();
  const { items, hydrated, addItem, setQuantity, removeItem, subtotalCents, count, clear } = useCart();

  const [justAuthed, setJustAuthed] = useState(false);
  const isAuthed = status === "authenticated" || justAuthed;
  const [step, setStep] = useState(1);
  const [selectedStates, setSelectedStates] = useState<string[]>(ACTIVE_STATES.map((s) => s.code));

  // Seed the cart from a ?pkg= link (legacy "Order leads" buttons) exactly once.
  const seeded = useRef(false);
  useEffect(() => {
    if (!hydrated || seeded.current) return;
    seeded.current = true;
    if (items.length === 0 && initialPackageId) {
      const pkg = findPackage(initialPackageId);
      if (pkg && pkg.available && !pkg.hidden) addItem(pkg.id, pkg.minimumOrder);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  const toggleState = (code: string) =>
    setSelectedStates((prev) => (prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]));

  const belowMin = items.some((i) => {
    const p = findPackage(i.packageId);
    return p && i.quantity < p.minimumOrder;
  });

  const paymentItems = items.map((i) => ({ packageId: i.packageId, quantity: i.quantity }));

  // Empty-cart state (unless we're on the confirmation screen post-purchase).
  if (hydrated && items.length === 0 && step !== 3) {
    return (
      <Card className="p-10 text-center max-w-lg mx-auto">
        <ShoppingCart className="h-10 w-10 mx-auto text-slate-300 mb-4" />
        <h2 className="text-xl font-semibold">Your cart is empty</h2>
        <p className="mt-2 text-sm text-muted-foreground">Add lead tiers from the marketplace to get started.</p>
        <Link href="/marketplace" className="inline-block mt-6">
          <Button>Browse the marketplace</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div>
      {/* Stepper */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 mb-8">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
          {steps.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2 shrink-0">
                <div
                  className={cn(
                    "h-7 w-7 grid place-items-center rounded-full text-xs font-medium",
                    done ? "bg-brand-red text-white" : active ? "bg-slate-200 text-foreground ring-2 ring-brand-red/40" : "bg-slate-100 text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : s.id}
                </div>
                <div className={cn("text-xs", active ? "text-foreground font-medium" : "text-muted-foreground")}>
                  {s.label}
                </div>
                {i !== steps.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/50" />}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <Card className="p-6">
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">Review your cart</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Mix any lead types and ages. One order is created per line.
                </p>
              </div>

              {/* Line items */}
              <div className="space-y-2">
                {items.map((item) => {
                  const pkg = findPackage(item.packageId);
                  if (!pkg) return null;
                  const min = pkg.minimumOrder;
                  return (
                    <div key={item.packageId} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{pkg.name}</div>
                          <div className="text-xs text-muted-foreground">{formatCurrency(pkg.pricePerLead)} / lead · min {min}</div>
                        </div>
                        <button onClick={() => removeItem(item.packageId)} className="text-muted-foreground hover:text-rose-600" aria-label="Remove">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="inline-flex items-center rounded-lg border border-slate-200">
                          <button onClick={() => setQuantity(item.packageId, Math.max(min, item.quantity - 25))} className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground" aria-label="Decrease">
                            <Minus className="h-3 w-3" />
                          </button>
                          <input
                            type="number"
                            value={item.quantity}
                            min={min}
                            onChange={(e) => setQuantity(item.packageId, Math.max(min, parseInt(e.target.value) || min))}
                            className="h-8 w-16 text-center text-sm border-x border-slate-200 outline-none"
                          />
                          <button onClick={() => setQuantity(item.packageId, item.quantity + 25)} className="h-8 w-8 grid place-items-center text-muted-foreground hover:text-foreground" aria-label="Increase">
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="text-sm font-semibold">{formatCurrency(pkg.pricePerLead * item.quantity)}</div>
                      </div>
                      {item.quantity < min && <p className="mt-2 text-[11px] text-rose-600">Minimum {min} leads for this tier.</p>}
                    </div>
                  );
                })}
              </div>

              {/* State filter (cart-wide) */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">
                    State filter <span className="text-muted-foreground font-normal">({selectedStates.length} selected)</span>
                  </div>
                  <div className="flex gap-3 text-xs">
                    <button type="button" className="text-red-600 hover:underline font-medium" onClick={() => setSelectedStates(ACTIVE_STATES.map((s) => s.code))}>Select all</button>
                    <button type="button" className="text-slate-500 hover:underline" onClick={() => setSelectedStates([])}>Clear</button>
                  </div>
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {ACTIVE_STATES.map((s) => (
                    <label key={s.code} className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors select-none", selectedStates.includes(s.code) ? "border-red-500 bg-red-50 text-red-700 font-medium" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300")}>
                      <Checkbox checked={selectedStates.includes(s.code)} onCheckedChange={() => toggleState(s.code)} className="h-3.5 w-3.5 shrink-0" />
                      {s.code}
                    </label>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">Applies to every tier in this order. More states = faster fulfillment.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">Payment</h2>
                <p className="text-sm text-muted-foreground mt-1">Securely processed via Stripe. Card, Apple Pay, Google Pay, and ACH supported.</p>
              </div>
              {isAuthed ? (
                <StripePaymentForm
                  items={paymentItems}
                  filterStates={selectedStates}
                  onSuccess={() => {
                    clear();
                    setStep(3);
                  }}
                />
              ) : (
                <CheckoutAuthPanel onAuthed={() => setJustAuthed(true)} />
              )}
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-10">
              <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-emerald-500/15 text-emerald-600 mb-4">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Order placed</h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                Your leads are in the queue. First leads typically land in your dashboard within 24 hours; the rest deliver on a rolling basis as inventory is generated.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <Link href="/dashboard"><Button>Go to dashboard</Button></Link>
                <Link href="/orders"><Button variant="outline">View order history</Button></Link>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="flex justify-end mt-8 pt-6 border-t border-slate-200">
              <Button onClick={() => setStep(2)} disabled={items.length === 0 || belowMin || selectedStates.length === 0}>
                Continue to payment <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          {step === 2 && (
            <div className="mt-6 pt-4 border-t border-slate-200">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="h-4 w-4" /> Back to cart
              </Button>
            </div>
          )}
        </Card>

        {/* Summary sidebar */}
        <div className="h-fit space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
              <CardDescription>{count} leads across {items.length} {items.length === 1 ? "tier" : "tiers"}.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {items.map((item) => {
                const pkg = findPackage(item.packageId);
                if (!pkg) return null;
                return (
                  <div key={item.packageId} className="flex justify-between gap-2">
                    <span className="text-muted-foreground truncate">{pkg.name} × {item.quantity}</span>
                    <span className="shrink-0">{formatCurrency(pkg.pricePerLead * item.quantity)}</span>
                  </div>
                );
              })}
              <div className="border-t border-slate-200 pt-3 flex justify-between text-base">
                <span className="font-medium">Total</span>
                <span className="font-semibold text-gradient">{formatCurrency(subtotalCents / 100)}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Badge variant="success">Compliant</Badge>
              <span className="text-xs">TCPA capture on every lead</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              TrustedForm / Jornaya certificate on every record. Replacement eligibility subject to quality review.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
