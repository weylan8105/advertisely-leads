import Link from "next/link";
import { ArrowRight, ShieldCheck, Target, Zap, RefreshCw, Database, Users } from "lucide-react";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { Button } from "@/components/ui/button";
import { VSLEmbed } from "@/components/marketing/VSLEmbed";

export const metadata = {
  title: "About Us — Advertisely Leads",
  description:
    "Why we built Advertisely Leads — the only IUL lead marketplace tuned to one product, one channel, one promise. Hear our story.",
};

export default function AboutPage() {
  return (
    <>
      <Navbar />
      <main>
        {/* ─── 1. VSL (above fold) ─────────────────────────────── */}
        <section className="relative bg-black text-white overflow-hidden">
          <div className="absolute -top-32 right-1/4 h-[500px] w-[500px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-32 left-1/4 h-[400px] w-[400px] rounded-full bg-brand-red/5 blur-3xl pointer-events-none" />
          <div className="relative container py-8 md:py-12 lg:py-14">
            <div className="max-w-4xl mx-auto">
              <div className="text-center mb-5 md:mb-6">
                <div className="inline-flex items-center gap-2 mb-3 md:mb-4">
                  <span className="h-px w-8 bg-brand-red" />
                  <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                    Watch our story
                  </span>
                </div>
                <h1 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.05] text-white">
                  Built by people who got tired of{" "}
                  <span className="text-brand-red">bad leads.</span>
                </h1>
              </div>

              <VSLEmbed
                title="The Advertisely Leads story — why we only do leads now."
              />
            </div>
          </div>
        </section>

        {/* ─── 2. CTA (above fold) ─────────────────────────────── */}
        <section className="container py-10 md:py-14">
          <div className="max-w-3xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 mb-4 md:mb-5 justify-center">
              <span className="h-px w-8 bg-brand-red" />
              <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                Ready to start?
              </span>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.05]">
              See for yourself why agents{" "}
              <span className="text-brand-red">switch and stay.</span>
            </h2>
            <p className="mt-4 text-sm md:text-base text-muted-foreground leading-relaxed max-w-xl mx-auto">
              Browse the marketplace, place your first order, and watch real IUL leads land in
              your dashboard tonight.
            </p>
            <div className="mt-6 md:mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/marketplace">
                <Button size="xl">
                  Browse leads <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="xl" variant="outline">
                  Create free account
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* ─── BELOW THE FOLD — supporting content ──────────────── */}

        {/* ─── Intro hero ──────────────────────────────────────── */}
        <section className="relative overflow-hidden border-t border-slate-200">
          <div className="absolute inset-0 bg-radial-glow pointer-events-none" />
          <div
            className="absolute inset-0 bg-grid-light pointer-events-none"
            style={{ backgroundSize: "32px 32px" }}
          />
          <div className="container relative py-20 lg:py-24">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 mb-6">
                <span className="h-px w-8 bg-brand-red" />
                <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                  About Us
                </span>
              </div>
              <h2 className="font-serif text-4xl md:text-6xl font-medium tracking-tight leading-[1.02]">
                Built by people who got tired of{" "}
                <span className="text-brand-red">bad leads.</span>
              </h2>
              <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-2xl leading-relaxed">
                Advertisely Leads exists because every agent we know has the same story —
                spending thousands on lead vendors, getting disconnected numbers, recycled
                contacts, and people who never asked about IUL in the first place. We built
                the platform we wished we had.
              </p>
            </div>
          </div>
        </section>

        {/* ─── Our story ──────────────────────────────────────────── */}
        <section className="container py-20 lg:py-28">
          <div className="grid lg:grid-cols-5 gap-12">
            <div className="lg:col-span-2">
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="h-px w-8 bg-brand-red" />
                <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                  Our story
                </span>
              </div>
              <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1]">
                We've been in your shoes.
              </h2>
            </div>
            <div className="lg:col-span-3 space-y-5 text-base text-muted-foreground leading-relaxed">
              <p>
                Advertisely was founded by agents and digital marketers who've spent years on
                both sides of the lead industry — buying leads that didn't convert, then
                running ad campaigns to generate better ones.
              </p>
              <p>
                The pattern was always the same: generic life-insurance leads being sold as
                "IUL-interested," prospects who'd filled out a form for something else
                entirely, batches recycled across multiple agencies, and zero source
                attribution to figure out what was actually working.
              </p>
              <p>
                Advertisely was built to solve all of that. A Meta-fed lead pipeline with
                strict IUL intent qualification, source tracking on every record, and a
                lightweight CRM so you can see exactly what's closing — and what's not.
              </p>
              <p className="text-foreground font-medium">
                One product, one channel, one promise. That focus is the whole point.
              </p>
            </div>
          </div>
        </section>

        {/* ─── What we do (now) — the pivot ─────────────────────── */}
        <section className="border-y border-slate-200 bg-slate-50">
          <div className="container py-20 lg:py-24">
            <div className="max-w-2xl mb-12">
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="h-px w-8 bg-brand-red" />
                <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                  What we do
                </span>
              </div>
              <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1]">
                Leads. Just leads.{" "}
                <span className="text-brand-red">Done right.</span>
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Advertisely focuses on one job and one job only — delivering clean,
                high-intent IUL leads with documented consent. Every system we've built and
                every campaign we run exists to support that single mission.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  icon: Target,
                  title: "Single-product focus",
                  body: "We don't sell Medicare, ACA, final expense, or auto. Only IUL. That focus shapes every campaign we run.",
                },
                {
                  icon: Database,
                  title: "Source-tracked records",
                  body: "Every lead carries the Meta campaign, ad set, and creative ID — so we (and you) can see what's converting.",
                },
                {
                  icon: ShieldCheck,
                  title: "Consent on every lead",
                  body: "TCPA-compliant capture, TrustedForm or Jornaya certificate, timestamped opt-in. No exceptions.",
                },
                {
                  icon: RefreshCw,
                  title: "Replacement policy",
                  body: "Bad numbers, disconnects, or off-niche records eligible for replacement within 72 hours of delivery.",
                },
              ].map((c) => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.title}
                    className="rounded-xl border border-slate-200 bg-white p-5"
                  >
                    <div className="h-10 w-10 grid place-items-center rounded-md bg-brand-red/10 border border-brand-red/20 text-brand-red">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="mt-4 font-medium tracking-tight">{c.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
                      {c.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ─── Who we serve ────────────────────────────────────── */}
        <section className="container py-20 lg:py-28">
          <div className="grid lg:grid-cols-2 gap-12 items-start">
            <div>
              <div className="inline-flex items-center gap-2 mb-5">
                <span className="h-px w-8 bg-brand-red" />
                <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                  Who we serve
                </span>
              </div>
              <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1]">
                Built for{" "}
                <span className="text-brand-red">producers</span>, not pretenders.
              </h2>
              <p className="mt-5 text-muted-foreground leading-relaxed">
                Advertisely was designed for a specific kind of agent — the ones who actually
                pick up the phone, run real discovery, and write IUL premium consistently. If
                you're looking for a vendor that promises a thousand leads and ships you nine
                hundred wrong numbers, we're not it.
              </p>
            </div>
            <div className="space-y-3">
              {[
                {
                  title: "Life insurance agents writing IUL",
                  body: "Independent producers and captive agents focused on tax-advantaged accumulation.",
                },
                {
                  title: "Agency builders running call nights",
                  body: "Recruiters and downline leaders who need consistent, qualified flow for their teams.",
                },
                {
                  title: "IUL-focused IMOs and FMOs",
                  body: "Marketing teams supporting producer rosters with a shared lead-buying budget.",
                },
                {
                  title: "Trade-union pension supplement specialists",
                  body: "Producers working blue-collar niches where our current inventory is strongest.",
                },
              ].map((s) => (
                <div
                  key={s.title}
                  className="rounded-lg border border-slate-200 bg-white p-4 flex items-start gap-3"
                >
                  <div className="h-8 w-8 grid place-items-center rounded-md bg-brand-red/10 text-brand-red shrink-0">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="font-medium tracking-tight">{s.title}</div>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                      {s.body}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── The promise (dark) ───────────────────────────────── */}
        <section className="relative bg-black text-white overflow-hidden">
          <div className="absolute -bottom-32 -right-32 h-[500px] w-[500px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />
          <div className="relative container py-20 lg:py-24">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 mb-6">
                <span className="h-px w-8 bg-brand-red" />
                <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                  The promise
                </span>
              </div>
              <h2 className="font-serif text-4xl md:text-5xl font-medium tracking-tight leading-[1.05] text-white">
                Every lead. Every time.{" "}
                <span className="text-brand-red">No exceptions.</span>
              </h2>
              <p className="mt-6 text-base md:text-lg text-white/65 leading-relaxed max-w-2xl">
                Documented TCPA consent. Real Meta campaign attribution. Timestamped opt-in
                with IP. Built-in replacement workflow if anything's off. We don't ship leads
                without a paper trail — ever — because that paper trail is what protects you
                and us when compliance asks.
              </p>
              <div className="mt-9 grid sm:grid-cols-3 gap-4">
                {[
                  { icon: Zap, label: "Real-time delivery", body: "Live as opt-ins happen" },
                  { icon: ShieldCheck, label: "Consent-first", body: "Certificate per lead" },
                  { icon: Database, label: "Source-tracked", body: "Campaign-level attribution" },
                ].map((p) => {
                  const Icon = p.icon;
                  return (
                    <div
                      key={p.label}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-sm"
                    >
                      <Icon className="h-5 w-5 text-brand-red mb-3" />
                      <div className="font-medium text-white">{p.label}</div>
                      <div className="text-xs text-white/55 mt-0.5">{p.body}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {/* ─── Bottom-of-page CTA echo ─────────────────────────── */}
        <section className="container py-20 lg:py-24">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-serif text-3xl md:text-4xl font-medium tracking-tight leading-[1.1]">
              Still reading?{" "}
              <span className="text-brand-red">Let's get you started.</span>
            </h2>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link href="/marketplace">
                <Button size="xl">
                  Browse leads <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
              <Link href="/signup">
                <Button size="xl" variant="outline">
                  Create free account
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
