"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, MapPin, Phone, Search, X } from "lucide-react";
import { LeadDetailModal } from "@/components/leads/LeadDetailModal";
import type { Lead } from "@/types";
import { cn } from "@/lib/utils";
import { downloadCsv } from "@/components/admin/csv";

export interface DrillLead {
  id: string;
  name: string;
  age: number | null;
  state: string;
  phone: string;
  email: string;
  occupation: string | null;
  income: number | null;
  stage: string;
  creditedTo: string;
  owner: string | null;
  apCents: number | null;
  at: string | null;
  receivedAt: string;
  source: string;
}

export interface DrillRequest {
  metric: string;
  title: string; // e.g. "Contacts · Jace Smith"
  /** How many the clicked number said, so a difference can be explained. */
  count: number;
  userId: string | null;
  /** range=…&from=…&to=… */
  query: string;
}

const money = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
const AT_LABEL: Record<string, string> = { leads: "Assigned", apps: "Submitted", policies: "Issued" };

/** The leads behind a Client Performance number, as cards; click one for its full lead card. */
export function ClientLeadsWindow({ req, onClose }: { req: DrillRequest; onClose: () => void }) {
  const [data, setData] = useState<{ total: number; limit: number; leads: DrillLead[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Lead | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setData(null); setFailed(false);
    const u = `/api/admin/live-stats/leads?metric=${req.metric}&${req.query}${req.userId ? `&userId=${encodeURIComponent(req.userId)}` : ""}`;
    fetch(u, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [req]);

  // Esc closes this window (the lead card handles its own Esc first).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !open) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!data) return [];
    if (!t) return data.leads;
    return data.leads.filter((l) =>
      [l.name, l.state, l.phone, l.email, l.occupation, l.stage, l.creditedTo, l.owner].some((v) => v?.toLowerCase().includes(t)),
    );
  }, [data, q]);

  async function openLead(id: string) {
    setOpening(id);
    try {
      const res = await fetch(`/api/admin/leads/${id}`);
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.lead) setOpen(d.lead as Lead);
    } finally {
      setOpening(null);
    }
  }

  function exportCsv() {
    if (!data) return;
    downloadCsv(
      `${req.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}.csv`,
      ["Name", "Age", "State", "Phone", "Email", "Occupation", "Income", "Stage", "Credited to", "Owner", "AP", AT_LABEL[req.metric] ?? "Date", "Received", "Source"],
      data.leads.map((l) => [
        l.name, l.age ?? "", l.state, l.phone, l.email, l.occupation ?? "", l.income ?? "", l.stage, l.creditedTo, l.owner ?? "",
        l.apCents != null ? (l.apCents / 100).toFixed(2) : "", day(l.at), day(l.receivedAt), l.source,
      ]),
    );
  }

  const multiAgentNote =
    data && !req.userId && data.total < req.count && ["contacts", "presentations"].includes(req.metric)
      ? `${req.count.toLocaleString()} counted across agents is ${data.total.toLocaleString()} different people: some leads were worked by more than one agent, and each agent gets credit.`
      : null;

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden bg-white shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{req.title}</h2>
            <p className="text-xs text-muted-foreground">
              {data
                ? `${data.total.toLocaleString()} lead${data.total === 1 ? "" : "s"}${data.total > data.leads.length ? ` · showing the newest ${data.leads.length}` : ""} · click a card for the full lead`
                : failed ? "Couldn't load the leads" : "Loading…"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={exportCsv}
              disabled={!data?.leads.length}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm font-medium hover:border-slate-400 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> CSV
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 place-items-center rounded-md hover:bg-slate-100">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="border-b border-slate-100 px-5 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, state, phone, stage, agent…"
              className="h-9 w-full rounded-md border border-slate-200 pl-8 pr-3 text-sm focus:border-slate-400 focus:outline-none"
            />
          </label>
          {multiAgentNote && <p className="mt-2 text-xs text-muted-foreground">{multiAgentNote}</p>}
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50 p-4">
          {!data && !failed && (
            <div className="grid place-items-center py-16 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>
          )}
          {data && shown.length === 0 && <p className="py-12 text-center text-sm text-muted-foreground">No leads.</p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => openLead(l.id)}
                className={cn(
                  "rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-400 hover:shadow",
                  opening === l.id && "opacity-60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{l.name || "No name"}</div>
                    <div className="text-xs text-muted-foreground">
                      {[l.age != null ? `Age ${l.age}` : null, l.occupation].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">{l.stage}</span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <div className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-slate-400" />{l.state || "—"}</div>
                  <div className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-slate-400" />{l.phone || "—"}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                  <span className="truncate">
                    {l.creditedTo}{l.owner && l.owner !== l.creditedTo ? ` (now ${l.owner})` : ""}
                  </span>
                  <span className="tabular-nums">
                    {l.apCents ? <strong className="text-slate-800">{money(l.apCents)}</strong> : null}
                    {l.at ? `${l.apCents ? " · " : ""}${AT_LABEL[req.metric] ?? ""} ${day(l.at)}` : ""}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
      {open && <LeadDetailModal lead={open} context="admin" onClose={() => setOpen(null)} />}
    </div>
  );
}
