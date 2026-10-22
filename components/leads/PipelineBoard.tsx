"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, GripVertical, MapPin, Clock, AlarmClock, Mail, Copy, Check, Users, X, Search } from "lucide-react";
import { PIPELINE_STAGES, DEFAULT_STAGE, WON_STAGE_ID, type PipelineStage } from "@/data/pipeline";
import { localTimeForState, stateName, stateCode } from "@/data/states";
import { cn, formatCurrency } from "@/lib/utils";

// Compact money for stage totals / card value (e.g. $6,000 or $141,832).
const money = (cents: number) =>
  formatCurrency(Math.round(cents) / 100).replace(/\.00$/, "");
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
  stages,
  openLeadId,
}: {
  leads: Lead[];
  /** Open this lead's contact card on load (e.g. arriving from /leads/[id]). */
  openLeadId?: string | null;
  setLeads: React.Dispatch<React.SetStateAction<Lead[]>>;
  /** The board's columns — a user's customized set, or the defaults. */
  stages?: PipelineStage[];
}) {
  const cols = stages && stages.length ? stages : PIPELINE_STAGES;
  const colIds = new Set(cols.map((s) => s.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Edge auto-scroll while dragging a card: hold the pointer near (or past) the
  // board's left/right edge — including over the sidebar or off the far side of
  // the screen — and the board keeps scrolling that way, faster nearer the edge.
  const boardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!draggingId) return;
    const EDGE = 140; // px from the board's visible edge where scrolling starts
    const MAX_SPEED = 28; // px per frame at the very edge
    let x: number | null = null;
    let raf = 0;
    const onDragOver = (e: DragEvent) => {
      if (e.clientX === 0 && e.clientY === 0) return; // spurious event some browsers fire at drag end
      x = e.clientX;
    };
    const tick = () => {
      const el = boardRef.current;
      if (el && x !== null) {
        const r = el.getBoundingClientRect();
        const left = Math.max(r.left, 0);
        const right = Math.min(r.right, window.innerWidth);
        let dx = 0;
        if (x < left + EDGE) dx = -MAX_SPEED * Math.min(1, (left + EDGE - x) / EDGE);
        else if (x > right - EDGE) dx = MAX_SPEED * Math.min(1, (x - (right - EDGE)) / EDGE);
        if (dx) el.scrollLeft += dx;
      }
      raf = requestAnimationFrame(tick);
    };
    document.addEventListener("dragover", onDragOver);
    raf = requestAnimationFrame(tick);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      cancelAnimationFrame(raf);
    };
  }, [draggingId]);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  const [callbackLead, setCallbackLead] = useState<Lead | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // The lead you're working with right now (last one whose number/email you copied,
  // card you opened, callback you set, or card you moved). Highlighted on the board and
  // pinned at the top so you never lose who you're talking to. Remembered on reload.
  const ACTIVE_KEY = "pipeline_active_lead";
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    try { setActiveId(localStorage.getItem(ACTIVE_KEY)); } catch { /* storage blocked */ }
  }, []);
  function markActive(id: string | null) {
    setActiveId(id);
    try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* ignore */ }
  }
  const activeLead = activeId ? leads.find((l) => l.id === activeId) ?? null : null;
  useEffect(() => {
    if (!openLeadId) return;
    const l = leads.find((x) => x.id === openLeadId);
    if (l) { markActive(l.id); setDetailLead(l); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLeadId, leads]);

  // Search: every word must match one of the lead's fields; phone matches on digits,
  // so "214-555", "(214) 555" and "214555" all find the same number.
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // "/" jumps to search (unless you're already typing somewhere).
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.key === "/" && !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const shown = useMemo(() => {
    const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) return leads;
    return leads.filter((l) => {
      const notes = (l.notes ?? []).map((n) => String((n as { body?: unknown }).body ?? "")).join(" ");
      const hay = [l.name, l.email, l.phone, l.state, l.state ? stateName(stateCode(l.state) ?? l.state) : "", l.zip, l.occupation, l.leadTypeLabel, l.source, notes]
        .filter(Boolean).join(" ").toLowerCase();
      const phoneDigits = (l.phone || "").replace(/\D/g, "");
      return words.every((w) => {
        if (hay.includes(w)) return true;
        const d = w.replace(/\D/g, "");
        return d.length >= 3 && phoneDigits.includes(d);
      });
    });
  }, [leads, query]);

  // Copy a phone/email to the clipboard from a card, with a brief ✓ confirmation.
  async function copyField(text: string, key: string) {
    markActive(key.split("-")[0]);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  // Tick every 30s so countdowns + local times stay fresh and cards flash when due.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function move(leadId: string, stageId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.pipelineStage === stageId) return;

    let premiumCents: number | undefined;
    if (stageId === WON_STAGE_ID) {
      const input = window.prompt(
        "Policy sold! Enter the annual premium (AP) in dollars — this feeds your Profit & Loss:",
        "",
      );
      if (input === null) return;
      const dollars = parseFloat(input.replace(/[^0-9.]/g, ""));
      premiumCents = Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
    }

    markActive(leadId);
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm font-semibold text-foreground">
          <Users className="h-4 w-4 text-brand-red" />
          {query ? `${shown.length} of ${leads.length}` : leads.length}
          <span className="font-normal text-muted-foreground">
            {query ? "match" + (shown.length === 1 ? "" : "es") : leads.length === 1 ? "lead in pipeline" : "leads in pipeline"}
          </span>
        </span>
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setQuery(""); (e.target as HTMLInputElement).blur(); } }}
            placeholder="Search name, phone, email, state…  ( / )"
            aria-label="Search leads in this pipeline"
            className="h-8 w-full rounded-full border border-slate-200 bg-white pl-8 pr-8 text-sm placeholder:text-muted-foreground focus:border-brand-red/50 focus:outline-none focus:ring-2 focus:ring-brand-red/15"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
              className="absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {activeLead && (
          <span className="inline-flex min-w-0 items-center gap-2 rounded-full border-2 border-brand-red bg-brand-red/[0.06] pl-3 pr-1 py-0.5 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full bg-brand-red animate-pulse" />
            <span className="text-muted-foreground shrink-0">Talking to</span>
            <button
              type="button"
              onClick={() => setDetailLead(activeLead)}
              className="truncate font-semibold text-foreground hover:underline"
              title="Open this lead"
            >
              {activeLead.name}
            </button>
            <span className="hidden sm:inline font-mono text-xs text-muted-foreground shrink-0">{activeLead.phone}</span>
            <button
              type="button"
              onClick={() => markActive(null)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-white hover:text-foreground"
              title="Clear"
              aria-label="Clear current lead"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
      <div ref={boardRef} className="overflow-x-auto pb-4 scrollbar-thin">
        <div className="flex gap-3 min-w-max">
          {cols.map((stage) => {
            const colLeads = shown.filter((l) => {
              const s = colIds.has(l.pipelineStage) ? l.pipelineStage : DEFAULT_STAGE;
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
                <div className="p-3 border-b border-slate-200">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2 w-2 rounded-full shrink-0", TONE_DOT[stage.tone])} />
                    <span className="text-xs font-medium leading-tight flex-1">{stage.label}</span>
                    <span className="text-[11px] text-muted-foreground bg-white border border-slate-200 rounded-full px-1.5">
                      {colLeads.length}
                    </span>
                  </div>
                  {(() => {
                    const totalCents = colLeads.reduce((sum, l) => sum + (l.valueCents ?? 0), 0);
                    return totalCents > 0 ? (
                      <div className="mt-1 pl-4 text-[11px] font-semibold text-emerald-700">{money(totalCents)}</div>
                    ) : null;
                  })()}
                </div>

                <div className="p-2 space-y-2 overflow-y-auto scrollbar-thin flex-1">
                  {colLeads.length === 0 && (
                    <div className="text-[11px] text-muted-foreground text-center py-6">{query ? "No matches" : "Drop leads here"}</div>
                  )}
                  {colLeads.map((lead) => {
                    const cb = callbackStatus(lead.callbackAt, now);
                    const local = localTimeForState(lead.state);
                    const rf = (lead.rawFormData || {}) as Record<string, unknown>;
                    const qCoverage = typeof rf.quiz_coverage === "string" ? rf.quiz_coverage : "";
                    const qBeneficiary = typeof rf.quiz_beneficiary === "string" ? rf.quiz_beneficiary : "";
                    return (
                      <div
                        key={lead.id}
                        draggable
                        onClick={() => {
                          markActive(lead.id);
                          setDetailLead(lead);
                        }}
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
                          activeId === lead.id
                            ? "border-brand-red ring-2 ring-brand-red ring-offset-1 bg-brand-red/[0.04] shadow-md"
                            : cb?.due ? "border-rose-300 ring-1 ring-rose-200 animate-pulse" : "border-slate-200",
                          draggingId === lead.id && "opacity-50",
                        )}
                      >
                        {activeId === lead.id && (
                          <div className="-mt-0.5 mb-1.5 inline-flex items-center gap-1 rounded-full bg-brand-red px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                            <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" /> Current
                          </div>
                        )}
                        <div className="flex items-start gap-1.5">
                          <GripVertical className="h-3.5 w-3.5 text-slate-300 mt-0.5 shrink-0 group-hover:text-slate-400 cursor-grab" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium truncate">{lead.name}</span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markActive(lead.id);
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

                            <div className="mt-1 flex flex-col gap-0.5 items-start">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyField(lead.phone, `${lead.id}-phone`);
                                }}
                                title="Click to copy number"
                                className="group/c inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand-red max-w-full"
                              >
                                <Phone className="h-2.5 w-2.5 shrink-0" />
                                <span className="font-mono truncate">{lead.phone}</span>
                                {copiedKey === `${lead.id}-phone` ? (
                                  <Check className="h-2.5 w-2.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <Copy className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover/c:opacity-60 transition-opacity" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyField(lead.email, `${lead.id}-email`);
                                }}
                                title="Click to copy email"
                                className="group/c inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-brand-red max-w-full"
                              >
                                <Mail className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{lead.email}</span>
                                {copiedKey === `${lead.id}-email` ? (
                                  <Check className="h-2.5 w-2.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <Copy className="h-2.5 w-2.5 shrink-0 opacity-0 group-hover/c:opacity-60 transition-opacity" />
                                )}
                              </button>
                            </div>

                            {typeof lead.valueCents === "number" && lead.valueCents > 0 && (
                              <div className="mt-1 text-xs font-semibold text-emerald-700">
                                {money(lead.valueCents)}
                              </div>
                            )}

                            <div className="mt-1.5 flex flex-wrap gap-1">
                              <span className="text-[10px] bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                                {lead.leadTypeLabel}
                              </span>
                              {qCoverage && (
                                <span className="text-[10px] bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                                  {qCoverage}
                                </span>
                              )}
                              {qBeneficiary && (
                                <span className="text-[10px] bg-slate-100 rounded px-1.5 py-0.5 text-slate-600">
                                  Beneficiary: {qBeneficiary}
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 text-[11px] text-muted-foreground flex items-center gap-1 flex-wrap">
                              <MapPin className="h-2.5 w-2.5 shrink-0" />
                              <span className="truncate" title={lead.state ? stateName(stateCode(lead.state) ?? lead.state ?? "") : undefined}>
                                {lead.state}{lead.zip ? ` ${lead.zip}` : ""}
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

      {detailLead && (
        <LeadDetailModal
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onAssigned={(leadId) => {
            // It now lives in someone else's pipeline — take it off this board.
            setTimeout(() => {
              setLeads((cur) => cur.filter((l) => l.id !== leadId));
              setDetailLead(null);
              if (activeId === leadId) markActive(null);
            }, 900);
          }}
          onNoteAdded={(leadId, note) => {
            // Persist the note into pipeline state so it survives reopening the card.
            setLeads((cur) =>
              cur.map((l) => (l.id === leadId ? { ...l, notes: [note, ...(l.notes ?? [])] } : l)),
            );
            setDetailLead((dl) =>
              dl && dl.id === leadId ? { ...dl, notes: [note, ...(dl.notes ?? [])] } : dl,
            );
          }}
          onValueChanged={(leadId, valueCents) => {
            setLeads((cur) => cur.map((l) => (l.id === leadId ? { ...l, valueCents: valueCents ?? undefined } : l)));
            setDetailLead((dl) => (dl && dl.id === leadId ? { ...dl, valueCents: valueCents ?? undefined } : dl));
          }}
        />
      )}
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
