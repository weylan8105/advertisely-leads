import {
  ShoppingBag,
  KanbanSquare,
  Phone,
  CheckSquare,
  Sheet,
  Webhook,
  Sparkles,
  RefreshCw,
} from "lucide-react";

const features = [
  {
    icon: ShoppingBag,
    title: "Lead marketplace",
    body: "Purpose-built IUL lead packages. Order what you actually want to dial.",
  },
  {
    icon: KanbanSquare,
    title: "Pipeline CRM",
    body: "Drag-and-drop pipeline, dispositions, tags, and notes — no separate CRM required.",
  },
  {
    icon: Phone,
    title: "Click-to-call, SMS, email",
    body: "Native tel/SMS/mailto links plus Twilio and dialer integrations.",
  },
  {
    icon: CheckSquare,
    title: "Tasks & follow-ups",
    body: "Schedule callbacks, send templates, and never let a lead go cold.",
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
        <div className="text-xs uppercase tracking-[0.18em] text-brand-red font-medium mb-3">
          Platform
        </div>
        <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
          Everything you need to run leads like an operator.
        </h2>
        <p className="mt-3 text-muted-foreground">
          Marketplace, CRM, and export pipes — under one roof. Designed to feel native to the
          way producing agencies actually run a call night.
        </p>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => {
          const Icon = f.icon;
          return (
            <div
              key={f.title}
              className="group relative rounded-xl border border-slate-200 bg-white p-5 hover:border-slate-300 hover:bg-white transition-colors"
            >
              {f.soon && (
                <span className="absolute top-3 right-3 text-[10px] uppercase tracking-wider text-brand-red/80">
                  Roadmap
                </span>
              )}
              <div className="h-10 w-10 grid place-items-center rounded-lg bg-slate-100 border border-slate-300 text-brand-red group-hover:scale-105 transition-transform">
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
