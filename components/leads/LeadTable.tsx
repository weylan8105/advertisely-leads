"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { StatusBadge } from "./StatusBadge";
import { ExportButton } from "./ExportButton";
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
import { leadStatuses } from "@/data/leads";
import { AVAILABLE_STATES, US_STATES } from "@/data/states";

interface LeadTableProps {
  leads: Lead[];
  showBulk?: boolean;
  compact?: boolean;
}

interface Toast {
  id: number;
  type: "success" | "error";
  message: string;
}

let toastCounter = 0;

export function LeadTable({ leads, showBulk = true, compact = false }: LeadTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Downline agents you can hand leads to (only owners/admins can reassign).
  const [members, setMembers] = useState<{ userId: string; name: string | null; email: string }[]>([]);
  const [canAssign, setCanAssign] = useState(false);

  useEffect(() => {
    fetch("/api/team")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) { setMembers(d.members ?? []); setCanAssign(!!d.canManage); } })
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        !search ||
        [l.name, l.email, l.phone, l.state, l.occupation, l.id, ...(l.tags ?? [])]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || l.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [leads, search, statusFilter]);

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

  // Click-to-copy for phone / email cells (Google-Sheets-style quick copy).
  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      addToast("success", `${label} copied`);
    } catch {
      addToast("error", `Couldn't copy ${label.toLowerCase()}`);
    }
  }

  // Most recent note body for the Notes column (leads carry notes newest-last).
  function latestNote(lead: Lead): string | null {
    const n = lead.notes;
    if (!n || n.length === 0) return null;
    return n[n.length - 1]?.body ?? null;
  }

  const selectedIds = Array.from(selected);

  async function submitReplacement(leadId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/admin/replacements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, reason: reason || "No reason provided" }),
      });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok && data.success, error: data.error };
    } catch {
      return { ok: false, error: "Network error" };
    }
  }

  async function requestReplacementOne(leadId: string, name: string) {
    const reason = window.prompt(`What's wrong with ${name}? (e.g., disconnected number, wrong info, never opted in)`);
    if (reason === null) return;
    const r = await submitReplacement(leadId, reason.trim());
    if (r.ok) addToast("success", `Replacement request submitted for ${name}. Our team will review within 72 hours.`);
    else addToast("error", r.error || "Could not submit the replacement request.");
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
      if (res.ok && data.ok) addToast("success", `Note added to ${name}.`);
      else addToast("error", data.error || "Could not add the note.");
    } catch {
      addToast("error", "Could not add the note.");
    }
  }

  // Manually reassign a lead to a downline agent (or unassign).
  async function assignLead(leadId: string, leadName: string, userId: string | null, agentName: string) {
    try {
      const res = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { addToast("error", data.error || "Could not reassign the lead."); return; }
      addToast("success", userId ? `${leadName} reassigned to ${agentName}.` : `${leadName} unassigned.`);
      setTimeout(() => window.location.reload(), 800);
    } catch {
      addToast("error", "Failed to reassign the lead.");
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
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {leadStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
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
              <TableHead className="text-[11px] uppercase tracking-wide">Status</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide">Notes</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-right text-muted-foreground/70">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((lead) => (
              <TableRow key={lead.id} className="hover:bg-slate-50/70">
                {showBulk && (
                  <TableCell className="sticky left-0 bg-white z-10">
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                )}
                <TableCell className="py-1.5">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="font-medium leading-tight hover:text-brand-red transition-colors"
                  >
                    {lead.name}
                  </Link>
                </TableCell>
                {/* Phone — click to copy */}
                <TableCell className="py-1.5">
                  <button
                    type="button"
                    onClick={() => copyText(lead.phone, "Phone")}
                    title="Click to copy number"
                    className="group inline-flex items-center gap-1.5 font-mono text-xs text-slate-700 hover:text-brand-red"
                  >
                    <span>{lead.phone}</span>
                    <Copy className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </button>
                </TableCell>
                {/* Email — click to copy */}
                <TableCell className="py-1.5">
                  <button
                    type="button"
                    onClick={() => copyText(lead.email, "Email")}
                    title="Click to copy email"
                    className="group inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-brand-red max-w-[240px]"
                  >
                    <span className="truncate">{lead.email}</span>
                    <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </button>
                </TableCell>
                <TableCell className="py-1.5 text-sm">{lead.state}</TableCell>
                <TableCell className="py-1.5">
                  <StatusBadge status={lead.status} />
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
                        <DropdownMenuItem asChild>
                          <Link href={`/leads/${lead.id}`}>
                            View details <ChevronRight className="h-3 w-3 ml-auto" />
                          </Link>
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
                        <DropdownMenuItem onClick={() => requestReplacementOne(lead.id, lead.name)}>
                          Request replacement
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
            ))}
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
    </div>
  );
}
