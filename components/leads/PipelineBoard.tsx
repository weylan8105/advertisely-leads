"use client";

import { useState } from "react";
import Link from "next/link";
import { Phone, GripVertical } from "lucide-react";
import { PIPELINE_STAGES, STAGE_IDS, DEFAULT_STAGE } from "@/data/pipeline";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types";

const TONE_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  red: "bg-brand-red",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
};

export function PipelineBoard({
  leads,
  setLeads,
}: {
  leads: Lead[];
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);

  async function move(leadId: string, stageId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.pipelineStage === stageId) return;
    const prev = lead.pipelineStage;
    // Optimistic
    setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, pipelineStage: stageId } : l)));
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stageId }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Move failed");
    } catch (e: any) {
      // Revert
      setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, pipelineStage: prev } : l)));
      alert(e.message ?? "Could not move lead");
    }
  }

  return (
    <div className="overflow-x-auto pb-4 scrollbar-thin">
      <div className="flex gap-3 min-w-max">
        {PIPELINE_STAGES.map((stage) => {
          const colLeads = leads.filter((l) => {
            // Fold any unknown/removed stage back into New Lead so no lead vanishes.
            const s = STAGE_IDS.includes(l.pipelineStage) ? l.pipelineStage : DEFAULT_STAGE;
            return s === stage.id;
          });
          const isOver = overStage === stage.id;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                if (overStage !== stage.id) setOverStage(stage.id);
              }}
              onDragLeave={(e) => {
                // only clear if leaving the column entirely
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || draggingId;
                if (id) move(id, stage.id);
                setOverStage(null);
                setDraggingId(null);
              }}
              className={cn(
                "w-64 shrink-0 rounded-xl border bg-slate-50/60 flex flex-col max-h-[70vh]",
                isOver ? "border-brand-red/50 bg-brand-red/[0.04]" : "border-slate-200",
              )}
            >
              <div className="p-3 border-b border-slate-200 flex items-center gap-2 sticky top-0">
                <span className={cn("h-2 w-2 rounded-full shrink-0", TONE_DOT[stage.tone])} />
                <span className="text-xs font-medium leading-tight flex-1">{stage.label}</span>
                <span className="text-[11px] text-muted-foreground bg-white border border-slate-200 rounded-full px-1.5">
                  {colLeads.length}
                </span>
              </div>

              <div className="p-2 space-y-2 overflow-y-auto scrollbar-thin flex-1">
                {colLeads.length === 0 && (
                  <div className="text-[11px] text-muted-foreground text-center py-6">Drop leads here</div>
                )}
                {colLeads.map((lead) => (
                  <div
                    key={lead.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", lead.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDraggingId(lead.id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setOverStage(null);
                    }}
                    className={cn(
                      "group rounded-lg border border-slate-200 bg-white p-2.5 cursor-grab active:cursor-grabbing shadow-sm",
                      draggingId === lead.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <GripVertical className="h-3.5 w-3.5 text-slate-300 mt-0.5 shrink-0 group-hover:text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-sm font-medium hover:text-brand-red truncate block"
                        >
                          {lead.name}
                        </Link>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="bg-slate-100 rounded px-1.5 py-0.5">{lead.state}</span>
                          <span className="inline-flex items-center gap-0.5 truncate">
                            <Phone className="h-2.5 w-2.5" /> {lead.phone}
                          </span>
                        </div>
                        {lead.tags.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {lead.tags.slice(0, 2).map((t) => (
                              <span key={t} className="text-[10px] bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
