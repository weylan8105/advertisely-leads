import { ShieldCheck, FileCheck, Clock4, FlagTriangleRight, BadgeCheck } from "lucide-react";

export function Compliance() {
  return (
    <section id="compliance" className="relative bg-black text-white overflow-hidden">
      <div className="absolute top-0 right-0 h-[500px] w-[500px] rounded-full bg-brand-red/10 blur-3xl pointer-events-none" />
      <div className="relative container py-20 lg:py-28">
        <div className="grid lg:grid-cols-5 gap-12">
          <div className="lg:col-span-2">
            <div className="inline-flex items-center gap-2 mb-5">
              <span className="h-px w-8 bg-brand-red" />
              <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">
                Compliance & trust
              </span>
            </div>
            <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1] text-white">
              The boring stuff your compliance officer will{" "}
              <span className="text-brand-red">love.</span>
            </h2>
            <p className="mt-5 text-white/60 leading-relaxed">
              Every lead delivered through Advertisely arrives with documented consent, a
              timestamped opt-in, and traceable Meta campaign attribution. We don't ship leads
              without a paper trail — ever.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs">
              <BadgeCheck className="h-3.5 w-3.5 text-brand-red" />
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
                <div
                  key={c.title}
                  className="rounded-xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-sm"
                >
                  <div className="h-9 w-9 grid place-items-center rounded-md bg-brand-red/15 border border-brand-red/30 text-brand-red">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="mt-3 font-medium text-white">{c.title}</div>
                  <p className="mt-1 text-xs text-white/60 leading-relaxed">{c.body}</p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-12 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-xs text-white/55">
          <span className="text-white font-medium">Disclaimers: </span>
          Lead availability varies by state and campaign volume. All leads should include
          documented consent before agent outreach. Advertisely does not guarantee sales
          outcomes. Replacement eligibility subject to quality review.
        </div>
      </div>
    </section>
  );
}
