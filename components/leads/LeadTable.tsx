"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ReplacementReasonDialog } from "@/components/leads/ReplacementReasonDialog";
import { LeadDetailModal } from "@/components/leads/LeadDetailModal";
import { replacementWindowClosed } from "@/lib/replacementReasons";
import {
  ChevronRight,
  Users,
  MoreHorizontal,
  Search,
  Phone,
  Mail,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  X,
  Copy,
  Plus,
  Gem,
  Loader2,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ExportButton } from "./ExportButton";
import {
  PIPELINE_STAGES,
  DEFAULT_STAGE,
  STAGE_TONE_STYLES,
  type PipelineStage,
} from "@/data/pipeline";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Lead } from "@/types";
import { AVAILABLE_STATES, US_STATES, stateName, stateCode } from "@/data/states";

interface LeadTableProps {
  leads: Lead[];
  showBulk?: boolean;
  compact?: boolean;
  /** Open this lead's contact card on load (e.g. arriving from /leads/[id]). */
  openLeadId?: string | null;
  /** The pipeline stages to color/filter rows by (defaults to the standard set). */
  stages?: PipelineStage[];
}

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

let toastCounter = 0;

export function LeadTable({ leads, showBulk = true, compact = false, stages, openLeadId }: LeadTableProps) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");

  // Resolve a lead's pipeline stage (id → label + color), falling back to the
  // default stage for unknown ids so a row always has a stage + tint.
  const stageList = stages && stages.length ? stages : PIPELINE_STAGES;
  const stageById = useMemo(() => new Map(stageList.map((s) => [s.id, s])), [stageList]);
  const stageFor = (lead: Lead) => stageById.get(lead.pipelineStage) ?? stageById.get(DEFAULT_STAGE) ?? stageList[0];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Downline agents you can hand leads to (only owners/admins can reassign).
  const [members, setMembers] = useState<{ userId: string; name: string | null; email: string }[]>([]);
  const [canAssign, setCanAssign] = useState(false);
  // Notes added this session, shown immediately in the Notes column (the leads
  // prop isn't refetched until the page reloads).
  const [noteOverrides, setNoteOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setMembers(d.members ?? []); setCanAssign(!!d.canManage); } })
      .catch(() => {});
    fetch("/api/goldmine")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setGoldmineOn(!!(d && d.enabled && d.canManage)))
      .catch(() => {});
  }, []);
  // Team owners/admins with Goldmine on can move selected leads into it.
  const [goldmineOn, setGoldmineOn] = useState(false);
  const [movingGm, setMovingGm] = useState(false);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        !search ||
        [l.name, l.email, l.phone, l.state, l.state ? stateName(stateCode(l.state) ?? l.state) : "", l.occupation, l.id, ...(l.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const stageId = stageById.has(l.pipelineStage) ? l.pipelineStage : DEFAULT_STAGE;
      const matchesStage = stageFilter === "all" || stageId === stageFilter;
      return matchesSearch && matchesStage;
    });
  }, [leads, search, stageFilter, stageById]);

  const allSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) {
      filtered.forEach((l) => next.delete(l.id));
    } else {
      filtered.forEach((l) => next.add(l.id));
    }
    setSelected(next);
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  function addToast(type: "success" | "error", message: string) {
    const id = ++toastCounter;
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }

  // The lead you're working with right now — shared with the Pipeline view (same key),
  // set when you copy their phone/email or open them. Outlined so you don't lose them.
  const ACTIVE_KEY = "pipeline_active_lead";
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    try { setActiveId(localStorage.getItem(ACTIVE_KEY)); } catch { /* storage blocked */ }
  }, []);
  function markActive(id: string) {
    setActiveId(id);
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* ignore */ }
  }

  // The lead contact card (same one the Pipeline view opens).
  const [detailLead, setDetailLead] = useState<Lead | null>(null);
  function openCard(lead: Lead) {
    markActive(lead.id);
    setDetailLead(lead);
  }
  useEffect(() => {
    if (!openLeadId) return;
    const l = leads.find((x) => x.id === openLeadId);
    if (l) openCard(l);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openLeadId, leads]);

  // Click-to-copy for phone / email cells (Google-Sheets-style quick copy).
  async function copyText(text: string, label: string, leadId?: string) {
    if (leadId) markActive(leadId);
    try {
      await navigator.clipboard.writeText(text);
      addToast("success", `${label} copied`);
    } catch {
      addToast("error", `Couldn't copy ${label.toLowerCase()}`);
    }
  }

  // Most recent note body for the Notes column. A note added this session wins;
  // otherwise use the newest saved note (the API returns them newest-first).
  function latestNote(lead: Lead): string | null {
    if (noteOverrides[lead.id]) return noteOverrides[lead.id];
    const n = lead.notes;
    if (!n || n.length === 0) return null;
    return n[0]?.body ?? null;
  }

  const selectedIds = Array.from(selected);

  // Replacement request via the shared reason-picker dialog.
  const [repLead, setRepLead] = useState<{ id: string; name: string } | null>(null);
  const [repBusy, setRepBusy] = useState(false);

  async function doReplacementSubmit(reasonCode: string, detail: string) {
    if (!repLead) return;
    const name = repLead.name;
    setRepBusy(true);
    try {
      const res = await fetch("/api/admin/replacements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: repLead.id, reasonCode, reason: detail || "No detail provided" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        addToast("success", `Replacement request submitted for ${name}. Our team will review within 72 hours.`);
        setRepLead(null);
      } else if (data.capExceeded) {
        // Over the 20% cap — point them to a new order instead.
        setRepLead(null);
        if (window.confirm(`${data.error}\n\nGo to the Marketplace to place a new order?`)) {
          window.location.href = "/marketplace";
        }
      } else {
        addToast("error", data.error || "Could not submit the replacement request.");
      }
    } catch {
      addToast("error", "Could not submit the replacement request.");
    } finally {
      setRepBusy(false);
    }
  }

  async function addNoteOne(leadId: string, name: string) {
    const body = window.prompt(`Add a note for ${name}:`);
    if (body === null) return;
    const text = body.trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/leads/${leadId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setNoteOverrides((prev) => ({ ...prev, [leadId]: text }));
        addToast("success", `Note added to ${name}.`);
      } else {
        addToast("error", data.error || "Could not add the note.");
      }
    } catch {
      addToast("error", "Could not add the note.");
    }
  }

  // Manually reassign a lead to a downline agent (or unassign).
  async function assignLead(leadId: string, leadName: string, userId: string | null, agentName: string, force = false): Promise<void> {
    try {
      const res = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, ...(force ? { force: true } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 422 && !force && userId) {
        const msg = String(data.error || "This lead doesn't match that agent's order.").replace(/ Pass force:true to override\.?/, "");
        if (window.confirm(`${msg}\n\nAssign it anyway?`)) return assignLead(leadId, leadName, userId, agentName, true);
        return;
      }
      if (!res.ok) { addToast("error", data.error || "Could not reassign the lead."); return; }
      addToast("success", userId ? `${leadName} reassigned to ${agentName}.` : `${leadName} unassigned.`);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      addToast("error", "Failed to reassign the lead.");
    }
  }

  // Move every selected lead from my pipeline into the team's Goldmine.
  async function moveSelectedToGoldmine() {
    if (selected.size === 0) return;
    const n = selected.size;
    if (!window.confirm(`Move ${n} lead${n === 1 ? "" : "s"} into your team's Goldmine? Your team will be able to work them, and they start over at the first Goldmine stage. Only leads in Dialed, Contacted or Call Back move; anything else, or with an upcoming callback, is skipped.`)) return;
    setMovingGm(true);
    try {
      const res = await fetch("/api/leads/move-to-goldmine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast("error", data.error || "Could not move the selected leads."); return; }
      const moved = data.count ?? n;
      addToast("success", `${moved} lead${moved === 1 ? "" : "s"} moved to Goldmine.`);
      if (data.skipped) addToast("error", `${data.skipped} skipped (not in Dialed, Contacted or Call Back, or a callback is still upcoming).`);
      setSelected(new Set());
      setTimeout(() => window.location.reload(), 800);
    } catch {
      addToast("error", "Failed to move the selected leads.");
    } finally {
      setMovingGm(false);
    }
  }

  // Bulk (re)assign every selected lead to a downline agent, or unassign them
  // all, in one request. Replacements are intentionally one-at-a-time only.
  async function assignBulk(userId: string | null, agentName: string) {
    if (selected.size === 0) return;
    try {
      const res = await fetch("/api/leads/assign-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds: selectedIds, userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast("error", data.error || "Could not reassign the selected leads."); return; }
      const n = data.count ?? selectedIds.length;
      addToast("success", userId ? `${n} lead${n === 1 ? "" : "s"} reassigned to ${agentName}.` : `${n} lead${n === 1 ? "" : "s"} unassigned.`);
      if (data.skipped) addToast("error", `${data.skipped} skipped (not in your organization).`);
      setSelected(new Set());
      setTimeout(() => window.location.reload(), 800);
    } catch {
      addToast("error", "Failed to reassign the selected leads.");
    }
  }

  return (
    <div className="space-y-4">
      <ReplacementReasonDialog
        open={!!repLead}
        leadName={repLead?.name ?? ""}
        busy={repBusy}
        onClose={() => setRepLead(null)}
        onSubmit={doReplacementSubmit}
      />
      {/* Toast notifications */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`flex items-start gap-2 rounded-lg border px-4 py-3 text-sm shadow-lg bg-white ${
                t.type === "success"
                  ? "border-emerald-200 text-emerald-800"
                  : "border-rose-200 text-rose-800"
              }`}
            >
              {t.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-rose-600" />
              )}
              <span className="flex-1">{t.message}</span>
              <button onClick={() => dismissToast(t.id)} className="shrink-0 opacity-60 hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!compact && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, phone, email, tag, ID…"
                className="pl-9"
              />
            </div>
            <Select value={stageFilter} onValueChange={setStageFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Stage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                {stageList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", STAGE_TONE_STYLES[s.tone].dot)} />
                      {s.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select defaultValue="any-state">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any-state">Any state</SelectItem>
                {US_STATES.map((s) => {
                  const available = AVAILABLE_STATES.includes(s);
                  return (
                    <SelectItem
                      key={s}
                      value={s}
                      title={stateName(s)}
                      disabled={!available}
                      className={!available ? "opacity-40" : ""}
                    >
                      {s} {!available && "· soon"}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {selected.size > 0 && goldmineOn && (
              <Button
                variant="outline"
                size="sm"
                onClick={moveSelectedToGoldmine}
                disabled={movingGm}
                className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              >
                {movingGm ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gem className="h-4 w-4" />}
                Move to Goldmine ({selected.size})
              </Button>
            )}
            {selected.size > 0 && canAssign && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Users className="h-4 w-4" />
                    Assign ({selected.size})
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {members.length > 0 && (
                    <>
                      <DropdownMenuLabel>Assign {selected.size} to agent</DropdownMenuLabel>
                      {members.map((m) => (
                        <DropdownMenuItem
                          key={m.userId}
                          onClick={() => assignBulk(m.userId, m.name ?? m.email)}
                        >
                          {m.name ?? m.email}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem onClick={() => assignBulk(null, "")}>
                    Unassign
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <ExportButton
              leadIds={selectedIds}
              count={selected.size > 0 ? selected.size : undefined}
              onSuccess={(msg) => addToast("success", msg)}
              onError={(msg) => addToast("error", msg)}
            />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-x-auto scrollbar-thin">
        <Table className="min-w-[880px] [&_td]:border-r [&_td]:border-slate-100 [&_th]:border-r [&_th]:border-slate-200 [&_td:last-child]:border-r-0 [&_th:last-child]:border-r-0">
          <TableHeader>
            <TableRow className="bg-slate-50">
              {showBulk && (
                <TableHead className="w-10 sticky left-0 bg-slate-50 z-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
              )}
              <TableHead className="text-[11px] uppercase tracking-wide">Name</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Phone</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Email</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide w-14">State</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Stage</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Notes</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-right text-muted-foreground/70">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((lead) => {
              const st = stageFor(lead);
              const styles = STAGE_TONE_STYLES[st?.tone ?? "slate"];
              return (
              <TableRow
                key={lead.id}
                className={cn(
                  "transition-colors", styles.row, "hover:brightness-[0.97]",
                  activeId === lead.id && "outline outline-2 outline-brand-red -outline-offset-2 relative z-[1]",
                )}
              >
                {showBulk && (
                  <TableCell className={cn("sticky left-0 z-10", styles.row)}>
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                )}
                <TableCell className="py-1.5">
                  <button
                    type="button"
                    onClick={() => openCard(lead)}
                    title="Open contact card"
                    className="font-medium leading-tight text-left hover:text-brand-red hover:underline transition-colors"
                  >
                    {lead.name}
                  </button>
                  {activeId === lead.id && (
                    <span className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-brand-red px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-white">
                      <span className="h-1 w-1 rounded-full bg-white animate-pulse" /> Current
                    </span>
                  )}
                </TableCell>
                {/* Phone — tap the number to call, icon to copy */}
                <TableCell className="py-1.5">
                  <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-700">
                    <a
                      href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`}
                      title="Tap to call"
                      className="hover:text-brand-red"
                    >
                      {lead.phone}
                    </a>
                    <button
                      type="button"
                      onClick={() => copyText(lead.phone, "Phone", lead.id)}
                      title="Copy number"
                      className="text-slate-400 hover:text-brand-red"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                  </span>
                </TableCell>
                {/* Email — click to copy */}
                <TableCell className="py-1.5">
                  <button
                    type="button"
                    onClick={() => copyText(lead.email, "Email", lead.id)}
                    title="Click to copy email"
                    className="group inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-brand-red max-w-[240px]"
                  >
                    <span className="truncate">{lead.email}</span>
                    <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </button>
                </TableCell>
                <TableCell className="py-1.5 text-sm whitespace-nowrap" title={lead.state ? stateName(stateCode(lead.state) ?? lead.state ?? "") : undefined}>{lead.state}{lead.zip ? ` ${lead.zip}` : ""}</TableCell>
                <TableCell className="py-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
                      styles.badge,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", styles.dot)} />
                    {st?.label ?? lead.pipelineStage}
                  </span>
                </TableCell>
                {/* Notes — latest note, click to add another */}
                <TableCell className="py-1.5">
                  <button
                    type="button"
                    onClick={() => addNoteOne(lead.id, lead.name)}
                    title="Add a note"
                    className="group inline-flex items-center gap-1 text-left text-xs max-w-[240px] text-slate-600 hover:text-brand-red"
                  >
                    {latestNote(lead) ? (
                      <span className="truncate">{latestNote(lead)}</span>
                    ) : (
                      <span className="inline-flex items-center gap-0.5 text-muted-foreground/60">
                        <Plus className="h-3 w-3" /> Note
                      </span>
                    )}
                  </button>
                </TableCell>
                <TableCell className="text-right py-1.5">
                  <div className="inline-flex items-center gap-1">
                    <a
                      href={`tel:${lead.phone.replace(/\D/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Call"
                      className="h-7 w-7 grid place-items-center rounded-md border border-slate-300 hover:bg-emerald-500/10 hover:border-emerald-500/40 hover:text-emerald-600 transition-colors"
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`sms:${lead.phone.replace(/\D/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Text"
                      className="h-7 w-7 grid place-items-center rounded-md border border-slate-300 hover:bg-sky-500/10 hover:border-sky-500/40 hover:text-sky-600 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`mailto:${lead.email}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Email"
                      className="h-7 w-7 grid place-items-center rounded-md border border-slate-300 hover:bg-violet-500/10 hover:border-violet-500/40 hover:text-violet-600 transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </a>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openCard(lead)}>
                          View details <ChevronRight className="h-3 w-3 ml-auto" />
                        </DropdownMenuItem>
                        <DropdownMenuItem>Log call disposition</DropdownMenuItem>
                        <DropdownMenuItem>Add task / reminder</DropdownMenuItem>
                        <DropdownMenuItem>Change status</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => addNoteOne(lead.id, lead.name)}>Add note</DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={async () => {
                            try {
                              const res = await fetch("/api/exports/ghl", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ leadIds: [lead.id] }),
                              });
                              const data = await res.json();
                              if (!res.ok) {
                                addToast("error", data.error ?? "GHL push failed.");
                              } else {
                                addToast("success", `${lead.name} pushed to GoHighLevel.`);
                              }
                            } catch {
                              addToast("error", "Failed to push to GoHighLevel.");
                            }
                          }}
                        >
                          Push to CRM (GHL)
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={replacementWindowClosed(lead.assignedAt)}
                          onClick={() => setRepLead({ id: lead.id, name: lead.name })}
                        >
                          {replacementWindowClosed(lead.assignedAt)
                            ? "Replacement window closed"
                            : "Request replacement"}
                        </DropdownMenuItem>
                        {canAssign && members.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>Assign to agent</DropdownMenuLabel>
                            {members.map((m) => (
                              <DropdownMenuItem
                                key={m.userId}
                                disabled={lead.assignedAgent != null && lead.assignedAgent === (m.name ?? m.email)}
                                onClick={() => assignLead(lead.id, lead.name, m.userId, m.name ?? m.email)}
                              >
                                {m.name ?? m.email}
                              </DropdownMenuItem>
                            ))}
                            <DropdownMenuItem onClick={() => assignLead(lead.id, lead.name, null, "")}>
                              Unassign
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={showBulk ? 8 : 7} className="text-center text-sm text-muted-foreground py-12">
                  No leads match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {detailLead && (
        <LeadDetailModal
          lead={detailLead}
          onClose={() => setDetailLead(null)}
          onAssigned={() => setTimeout(() => window.location.reload(), 900)}
          onNoteAdded={(leadId, note) => {
            setNoteOverrides((prev) => ({ ...prev, [leadId]: note.body }));
            setDetailLead((dl) => (dl && dl.id === leadId ? { ...dl, notes: [note, ...(dl.notes ?? [])] } : dl));
          }}
        />
      )}
    </div>
  );
}
