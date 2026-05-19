"use client";
import { useState } from "react";
import { Filter, X, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { US_STATES, AVAILABLE_STATES } from "@/data/states";
import { cn } from "@/lib/utils";

interface FilterSidebarProps {
  className?: string;
}

export function FilterSidebar({ className }: FilterSidebarProps) {
  const [states, setStates] = useState<string[]>(["TX", "FL"]);
  const [minInc, setMinInc] = useState(50000);
  const [maxInc, setMaxInc] = useState(200000);

  const toggle = (arr: string[], setArr: (v: string[]) => void, v: string) => {
    setArr(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  };

  return (
    <Card className={cn("p-5 space-y-6 h-fit sticky top-20", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-medium">
          <Filter className="h-4 w-4 text-brand-red" />
          Filters
        </div>
        <button className="text-xs text-muted-foreground hover:text-foreground">
          Reset
        </button>
      </div>

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
            Active states: <span className="text-foreground">TX, FL, CA, IL</span>. More
            states unlock as inventory grows.
          </span>
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Income range (annual)</Label>
        <div className="grid grid-cols-2 gap-2">
          <Input
            type="number"
            value={minInc}
            onChange={(e) => setMinInc(+e.target.value)}
            placeholder="Min"
          />
          <Input
            type="number"
            value={maxInc}
            onChange={(e) => setMaxInc(+e.target.value)}
            placeholder="Max"
          />
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Income is self-reported by prospect on form.
        </p>
      </div>

      <Button className="w-full" size="sm">
        Apply filters
      </Button>

      <p className="text-[10px] text-muted-foreground">
        Occupation niche is set by the lead package you choose. Lead availability varies by
        state and campaign volume.
      </p>
    </Card>
  );
}
