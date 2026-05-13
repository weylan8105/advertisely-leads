import { ShieldCheck, FileCheck, Clock4, FlagTriangleRight, BadgeCheck } from "lucide-react";

export function Compliance() {
  return (
    <section id="compliance" className="border-y border-white/[0.06] bg-brand-deepnavy">
      <div className="container py-20 lg:py-24">
        <div className="grid lg:grid-cols-5 gap-10">
          <div className="lg:col-span-2">
            <div className="text-xs uppercase tracking-[0.18em] text-brand-teal font-medium mb-3">
              Compliance & trust
            </div>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              The boring stuff your compliance officer will love.
            </h2>
            <p className="mt-4 text-muted-foreground">
              Every lead delivered through Advertisely arrives with documented consent, a
              timestamped opt-in, and traceable Meta campaign attribution. We don't ship leads
              without a paper trail — ever.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs">
              <BadgeCheck className="h-3.5 w-3.5 text-brand-teal" />
              TrustedForm / Jornaya certificate per lead
            </div>
          </div>

          <div className="lg:col-span-3 grid sm:grid-cols-2 gap-4">
            {[
              {
                icon: ShieldCheck,
                title: "TCPA-compliant consent capture",
                body: "Every form includes express written consent language disclosing your agency and call/text purpose.",
              },
              {
                icon: FileCheck,
                title: "Certificate-ready records",
                body: "TrustedForm or Jornaya certificate URL stored on every lead. Pull it on demand for compliance review.",
              },
              {
                icon: Clock4,
                title: "Timestamped opt-in",
                body: "Server-side timestamp + IP captured at form submission. Audit log preserved for the life of the account.",
              },
              {
                icon: FlagTriangleRight,
                title: "Source attribution",
                body: "Meta campaign, ad set, and creative ID stored on every record. Know which creative actually closes.",
              },
            ].map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.title} className="rounded-xl border border-white/[0.06] bg-card/40 p-5">
                  <div className="h-9 w-9 grid place-items-center rounded-md bg-white/[0.04] border border-white/10 text-brand-teal">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-3 font-medium">{c.title}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{c.body}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-10 rounded-xl border border-white/[0.06] bg-card/40 p-5 text-xs text-muted-foreground">
          <span className="text-foreground font-medium">Disclaimers: </span>
          Lead availability varies by state and campaign volume. All leads should include
          documented consent before agent outreach. Advertisely does not guarantee sales
          outcomes. Replacement eligibility subject to quality review.
        </div>
      </div>
    </section>
  );
}
