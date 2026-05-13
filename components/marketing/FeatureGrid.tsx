import {
  ShoppingBag,
  LayoutDashboard,
  Users,
  FileDown,
  Sheet,
  Webhook,
  Sparkles,
  RefreshCw,
} from "lucide-react";

const features = [
  {
    icon: ShoppingBag,
    title: "Lead marketplace",
    body: "Five purpose-built IUL packages. Order what you actually want to dial.",
  },
  {
    icon: LayoutDashboard,
    title: "Agent dashboard",
    body: "Performance, pipeline, and AP-at-a-glance for every agent on your roster.",
  },
  {
    icon: Users,
    title: "Built-in CRM",
    body: "Statuses, notes, agent assignment, and replacement requests in one place.",
  },
  {
    icon: FileDown,
    title: "CSV export",
    body: "Download any filtered view with full consent metadata attached.",
  },
  {
    icon: Sheet,
    title: "Google Sheets sync",
    body: "Auto-append new leads to a shared sheet your whole agency can see.",
  },
  {
    icon: Webhook,
    title: "Webhook / API ready",
    body: "POST new leads to any endpoint with HMAC-signed payloads. No middleware needed.",
  },
  {
    icon: Sparkles,
    title: "Auto-distribution",
    body: "Roadmap: route leads to agents by state, niche, or round-robin automatically.",
    soon: true,
  },
  {
    icon: RefreshCw,
    title: "Replacement requests",
    body: "Submit replacements for bad numbers, disconnected, or wrong-niche leads in one click.",
  },
];

export function FeatureGrid() {
  return (
    <section className="container py-20 lg:py-28">
      <div className="max-w-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-brand-teal font-medium mb-3">
          Platform
        </div>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Everything you need to run leads like an operator.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Marketplace, CRM, and export pipes — under one roof. Designed to feel native to the
          way GFI agencies actually run a call night.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="group relative rounded-xl border border-white/[0.06] bg-card/40 p-5 hover:border-white/15 hover:bg-card/60 transition-colors"
            >
              {f.soon && (
                <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wider text-brand-teal/80">
                  Roadmap
                </span>
              )}
              <div className="h-10 w-10 grid place-items-center rounded-lg bg-white/[0.04] border border-white/10 text-brand-teal group-hover:scale-105 transition-transform">
                <Icon className="h-5 w-5" />
              </div>
              <div className="mt-4 font-medium tracking-tight">{f.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
