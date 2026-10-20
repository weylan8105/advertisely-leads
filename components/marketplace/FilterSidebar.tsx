"use client";
import { useEffect, useState } from "react";
import { MapPin, ChevronDown, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { US_STATES, AVAILABLE_STATES } from "@/data/states";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  className?: string;
}

/**
 * The states we currently sell leads in, with the LIVE fresh-lead reserve per
 * state (from /api/inventory → byState). A green number = fresh leads ready in
 * that state right now; "RT" = none in reserve, so new leads there are delivered
 * in real time as they're generated. State SELECTION happens at checkout.
 */
export function FilterSidebar({ className }: FilterSidebarProps) {
  // Collapsed by default on mobile so it doesn't push the packages off-screen;
  // always expanded on desktop (lg) where it's a proper sidebar.
  const [open, setOpen] = useState(false);
  // null until the live inventory loads, so we don't flash "RT" before we know.
  const [byState, setByState] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/inventory")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active && d && typeof d.byState === "object") setByState(d.byState ?? {});
      })
      .catch(() => {
        if (active) setByState({});
      });
    return () => {
      active = false;
    };
  }, []);

  const freshTotal = byState
    ? Object.values(byState).reduce((s, n) => s + (n || 0), 0)
    : null;

  return (
    <Card className={cn("p-5 space-y-4 h-fit lg:sticky lg:top-20", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between lg:cursor-default"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 font-medium">
          <MapPin className="h-4 w-4 text-brand-red" />
          Available states
        </div>
        <span className="flex items-center gap-3">
          <Badge variant="muted" className="text-[10px]">
            {AVAILABLE_STATES.length} live
          </Badge>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform lg:hidden",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      <div className={cn("space-y-3", open ? "block" : "hidden", "lg:block")}>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted-foreground">Fresh leads in reserve</span>
          <span className="font-semibold tabular-nums">
            {freshTotal === null ? "…" : freshTotal.toLocaleString()}
          </span>
        </div>

        <div className="grid grid-cols-5 gap-1 rounded-md border border-slate-200 p-2 bg-slate-50">
          {US_STATES.map((s) => {
            const available = AVAILABLE_STATES.includes(s);
            const count = byState?.[s] ?? 0;
            const title = !available
              ? `${s} — not available yet`
              : count > 0
                ? `${s} — ${count} fresh lead${count === 1 ? "" : "s"} ready now`
                : `${s} — delivered in real time as generated`;
            return (
              <span
                key={s}
                title={title}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-1 rounded select-none",
                  available ? "bg-white border border-slate-200" : "opacity-40",
                )}
              >
                <span
                  className={cn(
                    "text-[11px]",
                    available
                      ? "font-medium text-foreground"
                      : "text-muted-foreground line-through",
                  )}
                >
                  {s}
                </span>
                {available &&
                  (count > 0 ? (
                    <span className="text-[9px] font-semibold tabular-nums text-emerald-600">{count}</span>
                  ) : byState ? (
                    <span className="text-[9px] font-medium text-sky-600">RT</span>
                  ) : (
                    <span className="text-[9px] text-transparent">·</span>
                  ))}
              </span>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="font-semibold text-emerald-600">#</span> fresh in reserve
          </span>
          <span className="flex items-center gap-1">
            <span className="font-medium text-sky-600">RT</span> delivered in real time
          </span>
        </div>

        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            You&apos;ll choose which states to order on the next step. A green number is how many
            fresh leads are ready in that state right now; <span className="font-medium text-sky-600">RT</span> states have
            none in reserve, so new leads there are delivered the moment they&apos;re generated.
            Greyed states aren&apos;t available yet.
          </span>
        </div>

        <p className="text-[10px] text-muted-foreground">
          Occupation niche is set by the lead package you choose. Lead availability varies by
          state and campaign volume.
        </p>
      </div>
    </Card>
  );
}
