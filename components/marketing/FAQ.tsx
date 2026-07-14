"use client";
import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    q: "How do I know these are real IUL-interested leads and not generic life leads?",
    a: "Every lead comes from a dedicated IUL campaign on Meta and self-selects an IUL-specific reason on the form — tax-free retirement income, a 401(k) alternative, pension supplement, or cash value with living benefits. Generic life inquiries don't get funneled into our IUL packages.",
  },
  {
    q: "How fast do leads show up after I order?",
    a: "Blue-Collar IUL leads deliver within 24 hours of your order. Every record arrives with documented consent and source tracking. Term Life leads are launching soon — join the notify list to be first in line.",
  },
  {
    q: "Are these TCPA-compliant?",
    a: "Every lead opts in through a Meta Lead Ads form with express consent language and a captured opt-in timestamp, and each record keeps its source campaign for traceability. As with any lead source, confirm consent and follow your own DNC and TCPA process before you dial.",
  },
  {
    q: "Can I filter by state, age, or occupation before I order?",
    a: "You can filter by state at checkout — choose the states you're licensed in and we only deliver from those. Occupation isn't a separate filter; it's built into the package itself (Blue-Collar IUL targets trades and union workers), so you get that niche by design. Age and income filters aren't self-serve yet.",
  },
  {
    q: "What's your replacement policy?",
    a: "Bad numbers, disconnected lines, and clear mismatches are eligible for replacement within 72 hours of delivery, subject to a brief quality review. Request one from the lead's page in your dashboard and our team follows up.",
  },
  {
    q: "Do you integrate with my CRM?",
    a: "Right now you can export leads to Google Sheets or download a CSV in one click. Native CRM push — GoHighLevel, Salesforce, HubSpot, Zapier, and custom webhooks — is on the roadmap and marked coming soon in your settings.",
  },
  {
    q: "Is there a minimum order?",
    a: "Blue-Collar IUL leads start at a 25-lead minimum. Minimums exist so we can fairly allocate campaign capacity across agents.",
  },
  {
    q: "How is this different from Goat Leads or other lead vendors?",
    a: "We do one product (IUL) with one media channel (Meta), tuned to one audience (IUL-focused producers). No grab-bag of Medicare, ACA, or final expense. No recycled leads dressed up. No surprises.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="container py-20 lg:py-28">
      <div className="max-w-2xl mx-auto text-center">
        <div className="inline-flex items-center gap-2 mb-5">
          <span className="h-px w-8 bg-brand-red" />
          <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">FAQ</span>
        </div>
        <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1]">
          Questions agents ask before they buy.
        </h2>
      </div>

      <div className="mt-12 max-w-3xl mx-auto space-y-2">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div
              key={i}
              className={cn(
                "rounded-xl border border-slate-200 bg-white overflow-hidden transition-colors",
                isOpen && "border-slate-300",
              )}
            >
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
              >
                <span className="font-medium text-sm">{f.q}</span>
                {isOpen ? (
                  <Minus className="h-4 w-4 text-brand-red shrink-0" />
                ) : (
                  <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
              </button>
              <div
                className={cn(
                  "grid transition-all duration-300 ease-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}
              >
                <div className="overflow-hidden">
                  <p className="px-5 pb-5 text-sm text-muted-foreground">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
