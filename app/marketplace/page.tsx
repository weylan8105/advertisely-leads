import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { PageHeader } from "@/components/layout/PageHeader";
import { LeadPackageCard } from "@/components/marketplace/LeadPackageCard";
import { FilterSidebar } from "@/components/marketplace/FilterSidebar";
import { leadPackages } from "@/data/packages";
import { Badge } from "@/components/ui/badge";

export default function MarketplacePage() {
  return (
    <>
      <Navbar />
      <main className="pb-24">
        <section className="relative border-b border-white/[0.06] overflow-hidden">
          <div className="absolute inset-0 bg-radial-glow opacity-60 pointer-events-none" />
          <div className="container relative py-14">
            <PageHeader
              eyebrow="Lead marketplace"
              title="IUL lead packages built for one job."
              description="Pick a package, set your filters, and your leads start flowing into your dashboard. Real-time delivery, TCPA-compliant capture, and full source attribution on every record."
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
              <div className="flex items-center justify-between mb-6">
                <div className="text-sm text-muted-foreground">
                  Showing <span className="text-foreground font-medium">{leadPackages.length}</span> packages
                </div>
                <div className="text-xs text-muted-foreground">
                  Sorted by: <span className="text-foreground">Recommended</span>
                </div>
              </div>
              <div className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 text-xs text-amber-200">
                <span className="font-medium">Heads up: </span>
                Only <strong>Blue-Collar IUL Leads</strong> are available for purchase right now.
                Other packages are in pre-launch — click <em>Notify me</em> on any "Coming soon"
                card and we'll email you when inventory opens.
              </div>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {leadPackages.map((p) => (
                  <LeadPackageCard key={p.id} pkg={p} highlight={p.id === "blue-collar-iul"} />
                ))}
              </div>

              <div className="mt-10 rounded-xl border border-white/[0.06] bg-card/40 p-5 text-xs text-muted-foreground">
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
