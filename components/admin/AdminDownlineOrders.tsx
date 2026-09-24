"use client";

import { useEffect, useState } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface DownlineOrder {
  id: string;
  packageId: string;
  quantity: number;
  fulfilledCount: number;
  status: string;
  createdAt: string;
  buyerName: string | null;
  buyerEmail: string | null;
  agentName: string | null;
  agentEmail: string | null;
  orgName: string | null;
}

const PKG_LABELS: Record<string, string> = {
  "blue-collar-iul": "Blue-Collar IUL",
  "trucker-leads": "Trucker IUL",
};
const pkgLabel = (id: string) => PKG_LABELS[id] ?? id;

const statusVariant: Record<string, "success" | "info" | "warning" | "muted"> = {
  DELIVERED: "success",
  DELIVERING: "info",
  PROCESSING: "warning",
};

export function AdminDownlineOrders() {
  const [orders, setOrders] = useState<DownlineOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/downline-orders")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setOrders(d.orders ?? []))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-rose-600 text-sm py-8 text-center">Couldn&apos;t load: {error}</div>;
  if (!orders)
    return (
      <div className="flex items-center gap-2 justify-center py-12 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading downline orders…
      </div>
    );
  if (orders.length === 0)
    return (
      <div className="text-center text-sm text-muted-foreground py-10">
        No orders have been placed for a downline agent yet.
      </div>
    );

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <table className="w-full text-sm min-w-[720px]">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-slate-200">
            <th className="text-left py-2 font-medium">Placed by (upline)</th>
            <th className="text-left py-2 font-medium">Delivers to (downline)</th>
            <th className="text-left py-2 font-medium">Team</th>
            <th className="text-left py-2 font-medium">Package</th>
            <th className="text-left py-2 font-medium">Progress</th>
            <th className="text-right py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => {
            const pct = o.quantity > 0 ? Math.round((o.fulfilledCount / o.quantity) * 100) : 0;
            return (
              <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="py-2.5">
                  <div className="font-medium">{o.buyerName ?? "—"}</div>
                  <div className="text-xs text-muted-foreground">{o.buyerEmail}</div>
                </td>
                <td className="py-2.5">
                  <div className="flex items-center gap-1.5 font-medium">
                    <ArrowRight className="h-3.5 w-3.5 text-brand-red shrink-0" />
                    {o.agentName ?? "—"}
                  </div>
                  <div className="text-xs text-muted-foreground">{o.agentEmail}</div>
                </td>
                <td className="py-2.5 text-muted-foreground">{o.orgName ?? "—"}</td>
                <td className="py-2.5">{pkgLabel(o.packageId)}</td>
                <td className="py-2.5">
                  <div className="w-36">
                    <div className="flex items-center justify-between text-[11px] mb-1">
                      <span className="tabular-nums font-medium">
                        {o.fulfilledCount}/{o.quantity}
                      </span>
                      <span
                        className={cn(
                          "tabular-nums",
                          pct >= 100 ? "text-emerald-600 font-medium" : "text-muted-foreground",
                        )}
                      >
                        {pct >= 100 ? "Complete" : `${pct}%`}
                      </span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                  </div>
                </td>
                <td className="py-2.5 text-right">
                  <Badge variant={statusVariant[o.status] ?? "muted"} className="text-[10px]">
                    {o.status}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-muted-foreground">
        Every order an upline placed for a downline agent, platform-wide. Leads deliver to the downline agent&apos;s
        pipeline — never the buyer&apos;s.
      </p>
    </div>
  );
}
