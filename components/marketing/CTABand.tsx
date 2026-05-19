import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CTABand() {
  return (
    <section className="container py-20 lg:py-24">
      <div className="relative overflow-hidden rounded-3xl border border-rose-200 bg-gradient-to-br from-rose-50 via-white to-rose-50 p-10 lg:p-16">
        <div className="absolute -top-32 -right-32 h-[400px] w-[400px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 h-[400px] w-[400px] rounded-full bg-brand-red/5 blur-3xl pointer-events-none" />
        <div className="relative max-w-2xl">
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Stop dialing recycled leads.{" "}
            <span className="text-gradient">Start writing IUL.</span>
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
