import Link from "next/link";
import { ArrowRight, Check, Clock, Sparkles, Lock, Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { LeadPackage } from "@/types";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface LeadPackageCardProps {
  pkg: LeadPackage;
  highlight?: boolean;
}

export function LeadPackageCard({ pkg, highlight }: LeadPackageCardProps) {
  const isAvailable = pkg.available;
  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden transition-all",
        highlight && isAvailable
          ? "ring-1 ring-brand-teal/40 shadow-[0_24px_80px_-12px_rgba(34,211,238,0.25)]"
          : "hover:border-white/15",
        !isAvailable && "opacity-90",
      )}
    >
      {pkg.badge && (
        <div className="absolute top-4 right-4 z-10">
          <Badge variant={isAvailable ? "success" : "muted"}>
            {isAvailable ? (
              <Sparkles className="h-3 w-3 mr-1" />
            ) : (
              <Lock className="h-3 w-3 mr-1" />
            )}
            {pkg.badge}
          </Badge>
        </div>
      )}
      <div className="p-6 flex-1 flex flex-col">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">{pkg.name}</h3>
          <p className="text-xs text-brand-teal mt-1">{pkg.tagline}</p>
        </div>
        <p className="mt-3 text-sm text-muted-foreground flex-1">{pkg.description}</p>

        <div className="mt-5 flex items-baseline gap-2">
          <span
            className={cn(
              "text-3xl font-semibold tracking-tight",
              !isAvailable && "text-muted-foreground",
            )}
          >
            {formatCurrency(pkg.pricePerLead)}
          </span>
          <span className="text-xs text-muted-foreground">/ lead</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Min order: {pkg.minimumOrder} leads
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          {pkg.estimatedDelivery}
        </div>

        <ul className="mt-5 space-y-2">
          {pkg.features.map((f) => (
            <li key={f} className="flex items-start gap-2 text-xs">
              <Check className="h-3.5 w-3.5 text-brand-teal mt-0.5 shrink-0" />
              <span className="text-muted-foreground">{f}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex flex-wrap gap-1.5">
          {pkg.niches.map((n) => (
            <Badge key={n} variant="muted" className="text-[10px]">
              {n}
            </Badge>
          ))}
        </div>

        {!isAvailable && pkg.comingSoonNote && (
          <div className="mt-5 rounded-md border border-amber-500/20 bg-amber-500/[0.04] p-3 text-[11px] text-amber-200">
            <span className="font-medium">Coming soon — </span>
            {pkg.comingSoonNote}
          </div>
        )}

        <div className="mt-6 flex gap-2">
          {isAvailable ? (
            <>
              <Link href={`/checkout?pkg=${pkg.id}`} className="flex-1">
                <Button className="w-full" size="sm">
                  Order leads <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
              <Button variant="outline" size="sm">
                Add to cart
              </Button>
            </>
          ) : (
            <>
              <Button className="flex-1" size="sm" variant="subtle" disabled>
                <Lock className="h-3.5 w-3.5" />
                Coming soon
              </Button>
              <Button variant="outline" size="sm">
                <Bell className="h-3.5 w-3.5" />
                Notify me
              </Button>
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
