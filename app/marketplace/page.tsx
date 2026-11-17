import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { MarketplaceTabs } from "@/components/marketplace/MarketplaceTabs";
import { MarketplaceHeaderBadges, ReplacementDisclaimer } from "@/components/marketplace/MarketplaceTabAware";
import { LEADS_PURCHASE_PAUSED, PURCHASE_PAUSED_MESSAGE } from "@/lib/flags";

const TITLE = "IUL lead packages built for one job.";
const DESCRIPTION =
  "Pick a package, set your filters, and your leads are delivered to your dashboard within 24 hours. TCPA-compliant capture and full source attribution on every record.";

/** Packages, tabs and disclaimers. States are picked at checkout, so there's no state panel here. */
function MarketplaceBody() {
  return (
    <>
      {LEADS_PURCHASE_PAUSED && (
        <div className="mb-6 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-800">
          <span className="font-semibold">Purchasing is paused. </span>
          {PURCHASE_PAUSED_MESSAGE}
        </div>
      )}
      <MarketplaceTabs />

      <div className="mt-10 rounded-xl border border-slate-200 bg-white p-5 text-xs text-muted-foreground">
        <span className="text-foreground font-medium">Disclaimers: </span>
        Lead availability varies by state and campaign volume. All leads include
        documented consent.<ReplacementDisclaimer /> Advertisely does not guarantee sales outcomes.
      </div>
    </>
  );
}

export default async function MarketplacePage() {
  const session = await getServerSession(authOptions);

  // Signed in: show it inside the platform, with the regular sidebar.
  if (session?.user) {
    return (
      <AppShell>
        <PageHeader eyebrow="Lead marketplace" title={TITLE} description={DESCRIPTION} actions={<MarketplaceHeaderBadges />} />
        <MarketplaceBody />
      </AppShell>
    );
  }

  // Visitors: the public site page.
  return (
    <>
      <Navbar />
      <main className="pb-24">
        <section className="relative border-b border-slate-200 overflow-hidden">
          <div className="absolute inset-0 bg-radial-glow opacity-60 pointer-events-none" />
          <div className="container relative py-14">
            <PageHeader eyebrow="Lead marketplace" title={TITLE} description={DESCRIPTION} actions={<MarketplaceHeaderBadges />} />
          </div>
        </section>
        <section className="container py-10">
          <MarketplaceBody />
        </section>
      </main>
      <Footer />
    </>
  );
}
