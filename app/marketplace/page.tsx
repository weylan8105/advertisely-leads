import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { MarketplaceStore } from "@/components/marketplace/MarketplaceStore";
import { FilterSidebar } from "@/components/marketplace/FilterSidebar";
import { Badge } from "@/components/ui/badge";

export default function MarketplacePage() {
  return (
    <>
      <Navbar />
      <main className="pb-24">
        <section className="relative border-b border-slate-200 overflow-hidden">
          <div className="absolute inset-0 bg-radial-glow opacity-60 pointer-events-none" />
          <div className="container relative py-14">
            <PageHeader
              eyebrow="Lead marketplace"
              title="IUL lead packages built for one job."
              description="Pick a package, set your filters, and your leads are delivered to your dashboard within 24 hours. TCPA-compliant capture and full source attribution on every record."
              actions={
                <div className="flex gap-2 flex-wrap">
                  <Badge variant="success">Live inventory</Badge>
                  <Badge variant="muted">Replacement-eligible</Badge>
                </div>
              }
            />
          </div>
        </section>

        <section className="container py-10">
          <div className="grid lg:grid-cols-[280px_1fr] gap-8">
            <FilterSidebar />
            <div>
              <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-800">
                <span className="font-medium">Heads up: </span>
                <strong>IUL leads are priced by age</strong> — pick fresh (under 48 hours) or go older for
                deep discounts, all under one product. Mix any ages in your cart; every order is a 25-lead
                minimum. Term Life is in pre-launch.
              </div>
              <MarketplaceStore />

              <div className="mt-10 rounded-xl border border-slate-200 bg-white p-5 text-xs text-muted-foreground">
                <span className="text-foreground font-medium">Disclaimers: </span>
                Lead availability varies by state and campaign volume. All leads include
                documented consent. Replacement eligibility subject to quality review.
                Advertisely does not guarantee sales outcomes.
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
