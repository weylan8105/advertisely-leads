import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTABand() {
  return (
    <section className="container py-20 lg:py-24">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-ink via-brand-deepnavy to-black p-10 lg:p-16">
        <div className="absolute inset-0 bg-radial-glow opacity-80 pointer-events-none" />
        <div className="absolute -inset-[1px] bg-gradient-to-r from-brand-teal/40 via-transparent to-brand-electric/40 rounded-3xl pointer-events-none [mask:linear-gradient(#000,transparent_60%)]" />
        <div className="relative max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Stop dialing recycled leads. Start writing IUL.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Spin up your Advertisely account in under two minutes. Browse the marketplace, place
            your first order, and watch the leads roll into your dashboard tonight.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup">
              <Button size="xl">
                Create your account <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/marketplace">
              <Button size="xl" variant="outline">
                Browse packages
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
