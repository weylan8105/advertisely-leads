import { CheckCircle2, Filter, Target, Layers } from "lucide-react";

export function LeadQuality() {
  return (
    <section className="container py-20 lg:py-28">
      <div className="grid lg:grid-cols-2 gap-12 items-center">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-brand-teal font-medium mb-3">
            Lead quality
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
            Built for one product. Done right.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Most lead vendors treat IUL as an afterthought, lumped in with Medicare, final
            expense, and ACA. We run dedicated IUL creative on Meta — pre-retiree tax strategy,
            blue-collar pension supplement, business owner exit planning, college savings
            alternatives. The result: leads that already know why they raised their hand.
          </p>

          <div className="mt-8 space-y-4">
            {[
              {
                icon: Target,
                title: "Intent-qualified at the form",
                body: "Every lead self-selects an IUL-specific reason: tax-free retirement, 401k alternative, cash value, pension supplement, college savings.",
              },
              {
                icon: Filter,
                title: "Filtered, not generic",
                body: "Order by state, age band, income range, and occupation niche. Your filters apply to delivery — not what we showed the ad to.",
              },
              {
                icon: Layers,
                title: "Source + campaign tracking",
                body: "Every record carries Meta campaign, ad set, and creative ID so you know what's converting before you spend on more.",
              },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="flex gap-3">
                  <div className="h-9 w-9 grid place-items-center rounded-md bg-white/[0.04] border border-white/10 text-brand-teal shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{f.title}</div>
                    <p className="text-xs text-muted-foreground mt-0.5">{f.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-6 bg-gradient-to-br from-brand-teal/15 via-transparent to-brand-electric/20 blur-3xl pointer-events-none" />
          <div className="relative rounded-2xl border border-white/10 bg-card/60 backdrop-blur-xl p-6">
            <div className="text-xs text-muted-foreground">Lead intent breakdown</div>
            <div className="text-2xl font-semibold mt-1">What our leads actually asked about</div>
            <div className="mt-6 space-y-4">
              {[
                ["Tax-free retirement income", 38, "from-brand-teal to-brand-electric"],
                ["401(k) / Roth alternatives", 22, "from-violet-400 to-violet-600"],
                ["Pension supplement (blue-collar)", 17, "from-amber-400 to-orange-500"],
                ["College savings + cash value", 13, "from-emerald-400 to-teal-500"],
                ["Business owner exit / buy-sell", 10, "from-rose-400 to-pink-500"],
              ].map(([label, pct, color]) => (
                <div key={label as string}>
                  <div className="flex justify-between text-xs mb-1">
                    <span>{label}</span>
                    <span className="text-muted-foreground">{pct}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/[0.04] overflow-hidden">
                    <div
                      className={`h-full rounded-full bg-gradient-to-r ${color}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 text-[11px] text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-brand-teal" />
              Aggregated from 12,400+ IUL form responses (rolling 90 days).
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
