"use client";
import { useState } from "react";
import { MapPin, ChevronDown, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { US_STATES, AVAILABLE_STATES } from "@/data/states";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  className?: string;
}

/**
 * Read-only display of the states we currently sell leads in. State SELECTION
 * happens on the next step (checkout), so this panel just shows what's live —
 * available states highlighted, not-yet-available ones greyed out.
 */
export function FilterSidebar({ className }: FilterSidebarProps) {
  // Collapsed by default on mobile so it doesn't push the packages off-screen;
  // always expanded on desktop (lg) where it's a proper sidebar.
  const [open, setOpen] = useState(false);

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
        <div className="grid grid-cols-5 gap-1 rounded-md border border-slate-200 p-2 bg-slate-50">
          {US_STATES.map((s) => {
            const available = AVAILABLE_STATES.includes(s);
            return (
              <span
                key={s}
                title={available ? `${s} — available` : `${s} — not available yet`}
                className={cn(
                  "text-[11px] py-1 text-center rounded select-none",
                  available
                    ? "font-medium text-foreground bg-white border border-slate-200"
                    : "text-muted-foreground opacity-40 line-through",
                )}
              >
                {s}
              </span>
            );
          })}
        </div>

        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            You&apos;ll choose which states to order on the next step. Greyed states aren&apos;t
            available yet — more unlock as inventory grows.
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
