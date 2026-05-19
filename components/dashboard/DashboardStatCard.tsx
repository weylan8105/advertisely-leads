import * as React from "react";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface DashboardStatCardProps {
  label: string;
  value: string | number;
  delta?: number;
  hint?: string;
  icon?: React.ReactNode;
  accent?: "teal" | "blue" | "violet" | "emerald" | "amber";
}

const accentMap: Record<NonNullable<DashboardStatCardProps["accent"]>, string> = {
  teal: "from-brand-red/20 to-transparent",
  blue: "from-brand-redDark/20 to-transparent",
  violet: "from-violet-500/20 to-transparent",
  emerald: "from-emerald-500/20 to-transparent",
  amber: "from-amber-500/20 to-transparent",
};

export function DashboardStatCard({ label, value, delta, hint, icon, accent = "teal" }: DashboardStatCardProps) {
  const positive = (delta ?? 0) >= 0;
  return (
    <Card className={cn("relative overflow-hidden p-5")}>
      <div
        className={cn(
          "absolute inset-0 bg-gradient-to-br pointer-events-none opacity-90",
          accentMap[accent],
        )}
      />
      <div className="relative">
        <div className="flex items-start justify-between">
          <div className="text-xs text-muted-foreground">{label}</div>
          {icon && (
            <div className="h-8 w-8 grid place-items-center rounded-md bg-slate-100 border border-slate-300 text-brand-red">
              {icon}
            </div>
          )}
        </div>
        <div className="mt-3 text-2xl font-semibold tracking-tight">{value}</div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          {typeof delta === "number" && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
                positive
                  ? "bg-emerald-500/15 text-emerald-600"
                  : "bg-rose-500/15 text-rose-600",
              )}
            >
              {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {hint && <span className="text-muted-foreground">{hint}</span>}
        </div>
      </div>
    </Card>
  );
}
