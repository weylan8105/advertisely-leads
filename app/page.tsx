import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/marketing/Hero";
import { TrustStats } from "@/components/marketing/TrustStats";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { LeadQuality } from "@/components/marketing/LeadQuality";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { PricingPreview } from "@/components/marketing/PricingPreview";
import { Compliance } from "@/components/marketing/Compliance";
import { FAQ } from "@/components/marketing/FAQ";
import { CTABand } from "@/components/marketing/CTABand";

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <main>
        <Hero />
        <TrustStats />
        <HowItWorks />
        <LeadQuality />
        <FeatureGrid />
        <PricingPreview />
        <Compliance />
        <FAQ />
        <CTABand />
      </main>
      <Footer />
    </>
  );
}
