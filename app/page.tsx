import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Hero } from "@/components/marketing/Hero";
import { TrustStats } from "@/components/marketing/TrustStats";
import { LiveStats } from "@/components/marketing/LiveStats";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { LeadQuality } from "@/components/marketing/LeadQuality";
import { FeatureGrid } from "@/components/marketing/FeatureGrid";
import { Advertisers } from "@/components/marketing/Advertisers";
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
        <LiveStats />
        <HowItWorks />
        <LeadQuality />
        <FeatureGrid />
        <Advertisers />
        <PricingPreview />
        <Compliance />
        <FAQ />
        <CTABand />
      </main>
      <Footer />
    </>
  );
}
