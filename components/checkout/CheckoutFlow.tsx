"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  CreditCard,
  Lock,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { leadPackages } from "@/data/packages";
import { formatCurrency, cn } from "@/lib/utils";
import type { LeadPackageId } from "@/types";

const steps = [
  { id: 1, label: "Package" },
  { id: 2, label: "Quantity & filters" },
  { id: 3, label: "Review" },
  { id: 4, label: "Payment" },
  { id: 5, label: "Confirmation" },
];

interface CheckoutFlowProps {
  initialPackageId?: LeadPackageId;
}

export function CheckoutFlow({ initialPackageId }: CheckoutFlowProps) {
  const [step, setStep] = useState(initialPackageId ? 2 : 1);
  const [pkgId, setPkgId] = useState<LeadPackageId>(initialPackageId ?? "fresh-iul");
  const pkg = useMemo(() => leadPackages.find((p) => p.id === pkgId)!, [pkgId]);
  const [qty, setQty] = useState<number>(pkg.minimumOrder);

  const total = pkg.pricePerLead * qty;

  return (
    <div>
      {/* Stepper */}
      <div className="rounded-xl border border-white/[0.06] bg-card/40 p-4 mb-8">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-thin">
          {steps.map((s, i) => {
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center gap-2 shrink-0">
                <div
                  className={cn(
                    "h-7 w-7 grid place-items-center rounded-full text-xs font-medium",
                    done
                      ? "bg-brand-teal text-slate-950"
                      : active
                      ? "bg-white/10 text-foreground ring-2 ring-brand-teal/40"
                      : "bg-white/[0.04] text-muted-foreground",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : s.id}
                </div>
                <div
                  className={cn(
                    "text-xs",
                    active ? "text-foreground font-medium" : "text-muted-foreground",
                  )}
                >
                  {s.label}
                </div>
                {i !== steps.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6">
        <Card className="p-6">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-xl font-semibold">Choose your lead package</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Pick the niche that fits your script.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {leadPackages.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPkgId(p.id);
                      setQty(p.minimumOrder);
                    }}
                    className={cn(
                      "text-left rounded-lg border p-4 transition-colors",
                      pkgId === p.id
                        ? "border-brand-teal/50 bg-brand-teal/[0.04]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{p.name}</div>
                      {pkgId === p.id && <Check className="h-4 w-4 text-brand-teal" />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.tagline}</div>
                    <div className="mt-3 flex items-end gap-1">
                      <span className="text-lg font-semibold">{formatCurrency(p.pricePerLead)}</span>
                      <span className="text-[11px] text-muted-foreground">/ lead</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-semibold">Set quantity & filters</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Minimum order: {pkg.minimumOrder} leads · Delivery: {pkg.estimatedDelivery}
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    value={qty}
                    min={pkg.minimumOrder}
                    onChange={(e) => setQty(Math.max(pkg.minimumOrder, +e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Daily delivery cap</Label>
                  <Select defaultValue="auto">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Deliver as available</SelectItem>
                      <SelectItem value="10">Max 10/day</SelectItem>
                      <SelectItem value="20">Max 20/day</SelectItem>
                      <SelectItem value="50">Max 50/day</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>State filter</Label>
                  <Select defaultValue="multi">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multi">TX, FL, OH, GA (+3 more)</SelectItem>
                      <SelectItem value="all">All licensed states</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Age range</Label>
                  <Select defaultValue="35-60">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25-40">25–40</SelectItem>
                      <SelectItem value="35-60">35–60</SelectItem>
                      <SelectItem value="50-70">50–70</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Income minimum</Label>
                  <Select defaultValue="60">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="50">$50k+</SelectItem>
                      <SelectItem value="60">$60k+</SelectItem>
                      <SelectItem value="100">$100k+</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Occupation niche</Label>
                  <Select defaultValue="any">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="trades">Trades & union</SelectItem>
                      <SelectItem value="medical">Medical professionals</SelectItem>
                      <SelectItem value="biz">Business owners</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Filters apply to delivered leads. Availability depends on live campaign volume.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">Review your order</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Double-check everything before payment.
                </p>
              </div>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] divide-y divide-white/[0.04]">
                <ReviewRow label="Package" value={pkg.name} />
                <ReviewRow label="Quantity" value={`${qty} leads`} />
                <ReviewRow label="Price per lead" value={formatCurrency(pkg.pricePerLead)} />
                <ReviewRow label="Estimated delivery" value={pkg.estimatedDelivery} />
                <ReviewRow label="Filters" value="TX, FL, OH · 35–60 · $60k+" />
              </div>
              <label className="flex items-start gap-2 text-xs text-muted-foreground">
                <Checkbox defaultChecked className="mt-0.5" />
                <span>
                  I acknowledge replacement eligibility is subject to quality review and that I will
                  only contact these leads after confirming captured TCPA consent.
                </span>
              </label>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-xl font-semibold">Payment</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Securely process via Stripe. Card or ACH supported.
                </p>
              </div>
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-200">
                Demo build — Stripe is not connected yet. This screen mocks the production checkout.
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Cardholder name</Label>
                  <Input placeholder="Jordan Pace" />
                </div>
                <div className="space-y-1.5">
                  <Label>Card number</Label>
                  <div className="relative">
                    <Input placeholder="4242 4242 4242 4242" className="pl-10" />
                    <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Expiry</Label>
                    <Input placeholder="MM / YY" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>CVC</Label>
                    <Input placeholder="123" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Lock className="h-3 w-3" /> Payments processed securely via Stripe.
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="text-center py-10">
              <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-emerald-500/15 text-emerald-300 mb-4">
                <CheckCircle2 className="h-7 w-7" />
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Order placed</h2>
              <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
                Your {qty} {pkg.name} are in the queue. First leads typically land in your
                dashboard within {pkg.estimatedDelivery.toLowerCase()}.
              </p>
              <div className="mt-6 flex justify-center gap-2">
                <Link href="/dashboard">
                  <Button>Go to dashboard</Button>
                </Link>
                <Link href="/orders">
                  <Button variant="outline">View order history</Button>
                </Link>
              </div>
            </div>
          )}

          {step < 5 && (
            <div className="flex justify-between mt-8 pt-6 border-t border-white/[0.06]">
              <Button
                variant="outline"
                onClick={() => setStep(Math.max(1, step - 1))}
                disabled={step === 1}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(Math.min(5, step + 1))}>
                {step === 4 ? "Place order" : "Continue"} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </Card>

        <div className="h-fit space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Order summary</CardTitle>
              <CardDescription>Live total updates as you change quantity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Package</span>
                <span>{pkg.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Quantity</span>
                <span>{qty} leads</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Price per lead</span>
                <span>{formatCurrency(pkg.pricePerLead)}</span>
              </div>
              <div className="border-t border-white/[0.06] pt-3 flex justify-between text-base">
                <span className="font-medium">Total</span>
                <span className="font-semibold text-gradient">{formatCurrency(total)}</span>
              </div>
              <div className="text-[10px] text-muted-foreground">
                Replacement credits applied for bad numbers within 72 hours of delivery.
              </div>
            </CardContent>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-2">
              <Badge variant="success">Compliant</Badge>
              <span className="text-xs">TCPA capture on every lead</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              TrustedForm / Jornaya certificate stored on every record. Replacement eligibility
              subject to quality review.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center p-3 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
