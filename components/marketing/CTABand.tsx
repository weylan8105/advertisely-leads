import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTABand() {
  return (
    <section className="container py-20 lg:py-24">
      <div className="relative overflow-hidden rounded-3xl bg-black p-10 lg:p-20">
        {/* subtle ambient glow corners */}
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-brand-red/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />

        <div className="relative max-w-3xl">
          <div className="inline-flex items-center gap-2 mb-7">
            <span className="h-px w-8 bg-brand-red" />
            <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
              For agents who close
            </span>
          </div>
          <h2 className="font-serif text-4xl md:text-5xl lg:text-6xl font-medium tracking-tight leading-[1.05] text-white">
            Stop dialing recycled leads.{" "}
            <span className="text-brand-red">Start writing IUL.</span>
          </h2>
          <p className="mt-6 text-base md:text-lg text-white/60 max-w-xl leading-relaxed">
            Spin up your Advertisely account in under two minutes. Browse the marketplace, place
            your first order, and watch the leads roll into your dashboard tonight.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button size="xl">
                Create your account <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/marketplace">
              <Button
                size="xl"
                className="bg-transparent border border-white/20 text-white hover:bg-white/10 shadow-none"
              >
                Browse packages
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
