import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { leadPackages } from "@/data/packages";
import { LeadPackageCard } from "@/components/marketplace/LeadPackageCard";
import { Button } from "@/components/ui/button";

export function PricingPreview() {
  return (
    <section id="pricing" className="container py-20 lg:py-28">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-12">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.18em] text-brand-red font-medium mb-3">
            Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Buy by the lead. Scale by the package.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Volume pricing kicks in automatically. Replacement credits applied to bad numbers
            and disconnected leads within 72 hours of delivery.
          </p>
        </div>
        <Link href="/marketplace">
          <Button variant="outline">
            View full marketplace <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {leadPackages.slice(0, 3).map((p) => (
          <LeadPackageCard key={p.id} pkg={p} highlight={p.id === "blue-collar-iul"} />
        ))}
      </div>
    </section>
  );
}
