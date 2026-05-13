import { Package, CreditCard, Download, Inbox } from "lucide-react";

const steps = [
  {
    icon: Package,
    title: "Choose a lead package",
    body:
      "Pick from Fresh IUL, Blue-Collar, Retirement-focused, MP-to-IUL cross-sell, or Aged volume packs.",
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
        <div className="text-xs uppercase tracking-[0.18em] text-brand-teal font-medium mb-3">
          How it works
        </div>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
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
              className="relative rounded-xl border border-white/[0.06] bg-card/40 p-5 hover:border-white/15 transition-colors"
            >
              <div className="absolute -top-3 right-4 text-[10px] font-mono text-muted-foreground/60">
                {String(i + 1).padStart(2, "0")}
              </div>
              <div className="h-10 w-10 grid place-items-center rounded-lg bg-gradient-to-br from-brand-teal/20 to-brand-electric/20 border border-white/10">
                <Icon className="h-5 w-5 text-brand-teal" />
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
