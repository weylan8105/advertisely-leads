"use client";
import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

const faqs = [
  {
    q: "How do I know these are real IUL-interested leads and not generic life leads?",
    a: "Every lead self-selects an IUL-specific intent reason on the form — tax-free retirement, 401k alternative, pension supplement, college savings, or business owner exit. Generic life inquiries never enter our IUL packages.",
  },
  {
    q: "How fast do leads show up after I order?",
    a: "Fresh and Retirement-Focused packages deliver in real-time (typically under 5 minutes from prospect submission). Blue-Collar and MP-to-IUL deliver within 24 hours. Aged packs deliver instantly as a CSV.",
  },
  {
    q: "Are these TCPA-compliant?",
    a: "Yes. Every Advertisely lead carries documented express written consent, a timestamp, IP address, and a TrustedForm or Jornaya certificate URL. We do not ship leads without a paper trail.",
  },
  {
    q: "Can I filter by state, age, or occupation before I order?",
    a: "Yes. Each package includes filters for state, age range, income range, and occupation/niche. Filters apply to what's delivered into your account — not retroactively.",
  },
  {
    q: "What's your replacement policy?",
    a: "Bad numbers, disconnected lines, and clear mismatches are eligible for replacement within 72 hours of delivery, subject to a brief quality review. Submit replacements directly inside your CRM with one click.",
  },
  {
    q: "Do you integrate with my CRM?",
    a: "We offer native integrations with GoHighLevel, Salesforce, HubSpot, and Zapier. You can also use the custom webhook to POST leads to any endpoint, or export to CSV / Google Sheets in one click.",
  },
  {
    q: "Is there a minimum order?",
    a: "Minimums vary by package, starting at 10 leads (Retirement-Focused) and ranging up to 100 leads for Aged packs. Minimums exist so we can fairly allocate campaign capacity across agents.",
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
        <div className="text-xs uppercase tracking-[0.18em] text-brand-red font-medium mb-3">
          FAQ
        </div>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
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
