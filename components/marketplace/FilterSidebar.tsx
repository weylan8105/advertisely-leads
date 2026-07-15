"use client";
import { useState } from "react";
import { Filter, X, Info, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { US_STATES, AVAILABLE_STATES } from "@/data/states";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  className?: string;
}

export function FilterSidebar({ className }: FilterSidebarProps) {
  const [states, setStates] = useState<string[]>(["TX", "FL"]);
  // Collapsed by default on mobile so it doesn't push the packages off-screen;
  // always expanded on desktop (lg) where it's a proper sidebar.
  const [open, setOpen] = useState(false);
  const toggle = (arr: string[], setArr: (v: string[]) => void, v: string) => {
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  return (
    <Card className={cn("p-5 space-y-5 h-fit lg:sticky lg:top-20", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between lg:cursor-default"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2 font-medium">
          <Filter className="h-4 w-4 text-brand-red" />
          Filters
          {states.length > 0 && (
            <Badge variant="muted" className="text-[10px] lg:hidden">
              {states.length}
            </Badge>
          )}
        </div>
        <span className="flex items-center gap-3">
          <span
            role="button"
            tabIndex={0}
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setStates([]);
            }}
          >
            Reset
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform lg:hidden",
              open && "rotate-180",
            )}
          />
        </span>
      </button>

      <div className={cn("space-y-5", open ? "block" : "hidden", "lg:block")}>
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>States</Label>
          <Badge variant="muted" className="text-[10px]">
            {AVAILABLE_STATES.length} live
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {states.map((s) => (
            <Badge
              key={s}
              variant="default"
              className="cursor-pointer"
              onClick={() => toggle(states, setStates, s)}
            >
              {s}
              <X className="h-3 w-3 ml-1" />
            </Badge>
          ))}
        </div>
        <div className="max-h-[180px] overflow-y-auto scrollbar-thin grid grid-cols-5 gap-1 rounded-md border border-slate-300 p-2 bg-slate-50">
          {US_STATES.map((s) => {
            const available = AVAILABLE_STATES.includes(s);
            const selected = states.includes(s);
            return (
              <button
                key={s}
                disabled={!available}
                onClick={() => available && toggle(states, setStates, s)}
                title={available ? `Filter to ${s}` : `${s} not available yet`}
                className={cn(
                  "text-[11px] py-1 rounded transition-colors relative",
                  !available && "opacity-40 text-muted-foreground cursor-not-allowed line-through",
                  available && !selected && "hover:bg-slate-100 text-muted-foreground",
                  selected && "bg-brand-red/20 text-brand-red",
                )}
              >
                {s}
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            Active states: <span className="text-foreground">TX, FL, CA, IL, PA, OH, CO, MI, WA</span>. More
            states unlock as inventory grows.
          </span>
        </div>
      </div>

      <Button className="w-full" size="sm">
        Apply filters
      </Button>

      <p className="text-[10px] text-muted-foreground">
        Occupation niche is set by the lead package you choose. Lead availability varies by
        state and campaign volume.
      </p>
      </div>
    </Card>
  );
}
