import { Database, Building2, FileDown, Plug } from "lucide-react";

const stats = [
  { icon: Database, label: "High-intent IUL leads", value: "Built for one product, done right" },
  { icon: Building2, label: "Built for agency scale", value: "Multi-seat workspaces & lead distribution" },
  { icon: FileDown, label: "Export-ready", value: "CSV + Google Sheets in one click" },
  { icon: Plug, label: "CRM-ready", value: "Webhooks, GHL, Salesforce, HubSpot" },
];

export function TrustStats() {
  return (
    <section className="border-y border-slate-200 bg-white/60 backdrop-blur">
      <div className="container py-10">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          {stats.map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.label} className="flex items-start gap-3">
                <div className="h-9 w-9 grid place-items-center rounded-md bg-slate-100 border border-slate-300 text-brand-red">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">{s.value}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
