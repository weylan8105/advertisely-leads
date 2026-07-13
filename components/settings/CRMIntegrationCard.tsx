import { Check, Plug, Lock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Integration } from "@/types";

const colorMap: Record<string, string> = {
  gohighlevel: "bg-amber-500/10 text-amber-700",
  salesforce: "bg-sky-500/10 text-sky-600",
  hubspot: "bg-orange-500/10 text-orange-600",
  zapier: "bg-orange-500/10 text-orange-600",
  sheets: "bg-emerald-500/10 text-emerald-600",
  webhook: "bg-violet-500/10 text-violet-600",
  dialer: "bg-rose-500/10 text-rose-600",
  twilio: "bg-rose-500/10 text-rose-600",
  calendar: "bg-sky-500/10 text-sky-600",
};

export function CRMIntegrationCard({ integration }: { integration: Integration }) {
  const isConnected = integration.status === "connected";
  const isComingSoon = integration.status === "coming_soon";
  return (
    <Card className="p-5 flex flex-col gap-4 hover:border-slate-300 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className={`h-10 w-10 grid place-items-center rounded-lg ${colorMap[integration.type] ?? "bg-slate-100 text-white"}`}>
          <Plug className="h-5 w-5" />
        </div>
        {isConnected ? (
          <Badge variant="success">
            <Check className="h-3 w-3 mr-1" /> Connected
          </Badge>
        ) : integration.status === "coming_soon" ? (
          <Badge variant="muted">
            <Lock className="h-3 w-3 mr-1" /> Coming soon
          </Badge>
        ) : (
          <Badge variant="muted">Available</Badge>
        )}
      </div>
      <div>
        <div className="font-semibold tracking-tight">{integration.name}</div>
        <p className="mt-1 text-xs text-muted-foreground">{integration.description}</p>
      </div>
      <Button
        variant={isConnected ? "outline" : "default"}
        size="sm"
        className="w-fit"
        disabled={isComingSoon}
      >
        {isConnected ? "Manage" : isComingSoon ? "Coming soon" : "Connect"}
      </Button>
    </Card>
  );
}
