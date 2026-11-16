"use client";

import { useEffect, useState } from "react";
import { KanbanSquare, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";

export type PipelineView = "board" | "list";

/** Board / list choice for a pipeline page, remembered per page on this device. */
export function usePipelineView(key: string): [PipelineView, (v: PipelineView) => void] {
  const storageKey = `adv:pipeline-view:${key}`;
  const [view, setView] = useState<PipelineView>("board");
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === "board" || v === "list") setView(v);
    } catch {
      /* storage blocked */
    }
  }, [storageKey]);
  const set = (v: PipelineView) => {
    setView(v);
    try {
      localStorage.setItem(storageKey, v);
    } catch {
      /* ignore */
    }
  };
  return [view, set];
}

export function ViewToggle({ view, onChange }: { view: PipelineView; onChange: (v: PipelineView) => void }) {
  const btn = (v: PipelineView, label: string, Icon: typeof Rows3, first: boolean) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      className={cn(
        "px-3 py-2 text-xs flex items-center gap-1.5 transition-colors",
        !first && "border-l border-slate-300",
        view === v ? "bg-slate-200 text-foreground" : "text-muted-foreground hover:bg-slate-100",
      )}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
  return (
    <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
      {btn("board", "Board view", KanbanSquare, true)}
      {btn("list", "List view", Rows3, false)}
    </div>
  );
}
