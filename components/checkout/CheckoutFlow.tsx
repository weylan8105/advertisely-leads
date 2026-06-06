"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronRight,
  Lock,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { StripePaymentForm } from "@/components/checkout/StripePaymentForm";
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
  const defaultPkg: LeadPackageId =
    initialPackageId && leadPackages.find((p) => p.id === initialPackageId)?.available
      ? initialPackageId
      : (leadPackages.find((p) => p.available)?.id ?? "blue-collar-iul");
  const [step, setStep] = useState(initialPackageId ? 2 : 1);
  const [pkgId, setPkgId] = useState<LeadPackageId>(defaultPkg);
  const pkg = useMemo(() => leadPackages.find((p) => p.id === pkgId)!, [pkgId]);
  const [qty, setQty] = useState<number>(pkg.minimumOrder);

  const total = pkg.pricePerLead * qty;

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
                    done
                      ? "bg-brand-red text-slate-950"
                      : active
                      ? "bg-slate-200 text-foreground ring-2 ring-brand-red/40"
                      : "bg-slate-100 text-muted-foreground",
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
                    disabled={!p.available}
                    onClick={() => {
                      if (!p.available) return;
                      setPkgId(p.id);
                      setQty(p.minimumOrder);
                    }}
                    className={cn(
                      "text-left rounded-lg border p-4 transition-colors relative",
                      pkgId === p.id && p.available
                        ? "border-brand-red/50 bg-brand-red/[0.04]"
                        : "border-slate-200 bg-slate-50",
                      p.available
                        ? "hover:bg-slate-100 cursor-pointer"
                        : "opacity-60 cursor-not-allowed",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium">{p.name}</div>
                      {pkgId === p.id && p.available && (
                        <Check className="h-4 w-4 text-brand-red" />
                      )}
                      {!p.available && (
                        <Badge variant="muted" className="text-[10px]">
                          <Clock className="h-3 w-3 mr-1" />
                          Soon
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">{p.tagline}</div>
                    <div className="mt-3 flex items-end gap-1">
                      {p.available ? (
                        <>
                          <span className="text-lg font-semibold">
                            {formatCurrency(p.pricePerLead)}
                          </span>
                          <span className="text-[11px] text-muted-foreground">/ lead</span>
                        </>
                      ) : (
                        <>
                          <span className="text-lg font-semibold text-muted-foreground">
                            Pending
                          </span>
                          <span className="text-[11px] text-muted-foreground">pricing</span>
                        </>
                      )}
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
                      <SelectItem value="multi">All 9 active states</SelectItem>
                      <SelectItem value="tx">TX only</SelectItem>
                      <SelectItem value="fl">FL only</SelectItem>
                      <SelectItem value="ca">CA only</SelectItem>
                      <SelectItem value="il">IL only</SelectItem>
                      <SelectItem value="pa">PA only</SelectItem>
                      <SelectItem value="oh">OH only</SelectItem>
                      <SelectItem value="co">CO only</SelectItem>
                      <SelectItem value="mi">MI only</SelectItem>
                      <SelectItem value="wa">WA only</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Active states: TX, FL, CA, IL, PA, OH, CO, MI, WA. More unlock as inventory grows.
                  </p>
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
              </div>

              <p className="text-xs text-muted-foreground">
                Occupation niche is set by the lead package itself. Filters above apply to
                delivered leads — availability depends on live campaign volume.
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
              <div className="rounded-lg border border-slate-200 bg-slate-50 divide-y divide-slate-200">
                <ReviewRow label="Package" value={pkg.name} />
                <ReviewRow label="Quantity" value={`${qty} leads`} />
                <ReviewRow label="Price per lead" value={formatCurrency(pkg.pricePerLead)} />
                <ReviewRow label="Estimated delivery" value={pkg.estimatedDelivery} />
                <ReviewRow label="Filters" value="All 9 active states · Income $60k+" />
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
                  Securely process via Stripe. Card, Apple Pay, Google Pay, and ACH supported.
                </p>
              </div>
              <StripePaymentForm
                packageId={pkg.id}
                quantity={qty}
                onSuccess={() => setStep(5)}
              />
            </div>
          )}

          {step === 5 && (
            <div className="text-center py-10">
              <div className="mx-auto h-14 w-14 grid place-items-center rounded-full bg-emerald-500/15 text-emerald-600 mb-4">
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

          {step < 4 && (
            <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
              <Button
                variant="outline"
                onClick={() => setStep(Math.max(1, step - 1))}
                disabled={step === 1}
              >
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(Math.min(5, step + 1))}>
                Continue <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          {step === 4 && (
            <div className="mt-6 pt-4 border-t border-slate-200">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep(3)}
              >
                <ArrowLeft className="h-4 w-4" /> Back to review
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
              <div className="border-t border-slate-200 pt-3 flex justify-between text-base">
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
