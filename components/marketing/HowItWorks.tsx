import { Package, CreditCard, Download, Inbox } from "lucide-react";

const steps = [
  {
    icon: Package,
    title: "Choose a lead package",
    body:
      "Start with Blue-Collar IUL leads, available now. Term Life leads are coming soon.",
  },
  {
    icon: CreditCard,
    title: "Place your order",
    body:
      "Set quantity and filters — state, age, income, occupation. Pay securely with card or ACH.",
  },
  {
    icon: Inbox,
    title: "Leads land in your dashboard",
    body:
      "Fresh leads stream in real-time. Every record arrives with consent proof and source tracking.",
  },
  {
    icon: Download,
    title: "Export to CRM, CSV, or Sheets",
    body:
      "Push directly to GHL, Salesforce, HubSpot — or send via webhook. CSV and Sheets in one click.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="container py-20 lg:py-28">
      <div className="max-w-2xl">
        <div className="inline-flex items-center gap-2 mb-5">
          <span className="h-px w-8 bg-brand-red" />
          <span className="bg-brand-red text-white text-[10px] uppercase tracking-[0.22em] font-semibold px-2 py-0.5 rounded-sm">How it works</span>
        </div>
        <h2 className="font-serif text-3xl md:text-5xl font-medium tracking-tight leading-[1.1]">
          From order to closed appointment in a single afternoon.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Built specifically for IUL producers. No bait-and-switch, no recycled leads dressed up,
          no consent gaps. Just the cleanest IUL pipeline you've worked.
        </p>
      </div>

      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <div
              key={s.title}
              className="relative rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 transition-colors"
            >
              <div className="absolute -top-3 right-4 text-[10px] font-mono text-muted-foreground/60">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="h-10 w-10 grid place-items-center rounded-lg bg-gradient-to-br from-brand-red/20 to-brand-redDark/20 border border-slate-300">
                <Icon className="h-5 w-5 text-brand-red" />
              </div>
              <div className="mt-4 font-medium tracking-tight">{s.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
