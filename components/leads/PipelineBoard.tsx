"use client";

import { useEffect, useState } from "react";
import { Phone, GripVertical, MapPin, Clock, AlarmClock } from "lucide-react";
import { PIPELINE_STAGES, STAGE_IDS, DEFAULT_STAGE } from "@/data/pipeline";
import { localTimeForState } from "@/data/states";
import { cn } from "@/lib/utils";
import type { Lead } from "@/types";
import { LeadDetailModal } from "@/components/leads/LeadDetailModal";
import { CallbackModal } from "@/components/leads/CallbackModal";

const TONE_DOT: Record<string, string> = {
  slate: "bg-slate-400",
  red: "bg-brand-red",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
  indigo: "bg-indigo-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
};

function receivedAgo(iso: string): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const d = Math.floor(ms / 86_400_000);
  if (d >= 1) return `${d}d ago`;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h}h ago`;
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `${m}m ago`;
}

function fmtDuration(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return mm ? `${h}h ${mm}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** Callback pill status for a card. */
function callbackStatus(callbackAt: string | undefined, now: number) {
  if (!callbackAt) return null;
  const diff = new Date(callbackAt).getTime() - now;
  if (diff <= 0) return { due: true, label: `Call now · ${fmtDuration(-diff)} overdue` };
  return { due: false, label: `Callback in ${fmtDuration(diff)}` };
}

export function PipelineBoard({
  leads,
  setLeads,
}: {
  leads: Lead[];
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [callbackLead, setCallbackLead] = useState<Lead | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick every 30s so countdowns + local times stay fresh and cards flash when due.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function move(leadId: string, stageId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.pipelineStage === stageId) return;

    let premiumCents: number | undefined;
    if (stageId === "issued-paid") {
      const input = window.prompt(
        "Policy sold! Enter the annual premium (AP) in dollars — this feeds your Profit & Loss:",
        "",
      );
      if (input === null) return;
      const dollars = parseFloat(input.replace(/[^0-9.]/g, ""));
      premiumCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    }

    const prev = lead.pipelineStage;
    setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, pipelineStage: stageId } : l)));
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: stageId, ...(premiumCents != null ? { premiumCents } : {}) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Move failed");
    } catch (e: any) {
      setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, pipelineStage: prev } : l)));
      alert(e.message ?? "Could not move lead");
    }
  }

  function onCallbackSaved(leadId: string, iso: string | null) {
    setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, callbackAt: iso ?? undefined } : l)));
  }

  return (
    <>
      <div className="overflow-x-auto pb-4 scrollbar-thin">
        <div className="flex gap-3 min-w-max">
          {PIPELINE_STAGES.map((stage) => {
            const colLeads = leads.filter((l) => {
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
                  "w-64 shrink-0 rounded-xl border bg-slate-50/60 flex flex-col max-h-[72vh]",
                  isOver ? "border-brand-red/50 bg-brand-red/[0.04]" : "border-slate-200",
                )}
              >
                <div className="p-3 border-b border-slate-200 flex items-center gap-2">
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
                  {colLeads.map((lead) => {
                    const cb = callbackStatus(lead.callbackAt, now);
                    const local = localTimeForState(lead.state);
                    const fieldCount = lead.rawFormData ? Object.keys(lead.rawFormData).length : 0;
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onClick={() => setDetailLead(lead)}
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
                          "group rounded-lg border bg-white p-2.5 cursor-pointer shadow-sm hover:border-slate-300 transition-colors",
                          cb?.due ? "border-rose-300 ring-1 ring-rose-200 animate-pulse" : "border-slate-200",
                          draggingId === lead.id && "opacity-50",
                        )}
                      >
                        <div className="flex items-start gap-1.5">
                          <GripVertical className="h-3.5 w-3.5 text-slate-300 mt-0.5 shrink-0 group-hover:text-slate-400 cursor-grab" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">{lead.name}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCallbackLead(lead);
                                }}
                                title={lead.callbackAt ? "Edit callback reminder" : "Set a callback reminder"}
                                className={cn(
                                  "shrink-0 grid place-items-center h-6 w-6 rounded-md border transition-colors",
                                  cb?.due
                                    ? "border-rose-300 bg-rose-50 text-rose-600"
                                    : lead.callbackAt
                                      ? "border-blue-200 bg-blue-50 text-blue-600"
                                      : "border-slate-200 text-slate-400 hover:text-brand-red hover:border-brand-red/40",
                                )}
                              >
                                <AlarmClock className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="mt-0.5 text-[11px] text-muted-foreground inline-flex items-center gap-1">
                              <Phone className="h-2.5 w-2.5" /> {lead.phone}
                            </div>

                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <span className="text-[10px] bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                                {lead.leadTypeLabel}
                              </span>
                              {fieldCount > 0 && (
                                <span className="text-[10px] bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                                  {fieldCount} fields
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate">
                                {lead.state}
                                {local ? ` · ${local}` : ""}
                              </span>
                              <span className="text-slate-300">·</span>
                              <span>{receivedAgo(lead.receivedAt)}</span>
                            </div>

                            {cb && (
                              <div
                                className={cn(
                                  "mt-2 text-[11px] rounded px-1.5 py-1 inline-flex items-center gap-1 font-medium",
                                  cb.due ? "bg-rose-100 text-rose-700" : "bg-blue-50 text-blue-700",
                                )}
                              >
                                <Clock className="h-3 w-3" /> {cb.label}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {detailLead && <LeadDetailModal lead={detailLead} onClose={() => setDetailLead(null)} />}
      {callbackLead && (
        <CallbackModal
          lead={callbackLead}
          onClose={() => setCallbackLead(null)}
          onSaved={(iso) => onCallbackSaved(callbackLead.id, iso)}
        />
      )}
    </>
  );
}
