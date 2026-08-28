"use client";

import { X, Phone, Mail, MapPin, ShieldCheck } from "lucide-react";
import type { Lead } from "@/types";
import { localTimeForState } from "@/data/states";
import { formatCurrency } from "@/lib/utils";

function prettyKey(k: string) {
  return k
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\?$/, "")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
function prettyVal(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    try {
      return Object.entries(v as Record<string, unknown>)
        .map(([k, val]) => `${prettyKey(k)}: ${val}`)
        .join(" · ");
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function LeadDetailModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const local = localTimeForState(lead.state);
  const raw = lead.rawFormData ?? {};
  const entries = Object.entries(raw).filter(([, v]) => prettyVal(v).trim() !== "");

  const facts: [string, string][] = (
    [
      ["Phone", lead.phone],
      ["Email", lead.email],
      ["State", lead.state],
      ["Age", lead.age ? String(lead.age) : ""],
      ["Income", lead.income ? formatCurrency(lead.income) : ""],
      ["Occupation", lead.occupation],
      ["Lead type", lead.leadTypeLabel],
      ["Source", lead.source],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight truncate">{lead.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" /> {lead.phone}
              </span>
              {lead.email && (
                <span className="inline-flex items-center gap-1">
                  <Mail className="h-3.5 w-3.5" /> {lead.email}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" /> {lead.state}
                {local ? ` · ${local} local` : ""}
              </span>
            </div>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto scrollbar-thin space-y-6">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Lead details</div>
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium text-right break-words">{v}</span>
                </div>
              ))}
            </div>
          </div>

          {lead.intentReason && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Why IUL / intent</div>
              <p className="text-sm">{lead.intentReason}</p>
            </div>
          )}

          {entries.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
                Form answers <span className="text-muted-foreground/70">({entries.length} fields)</span>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {entries.map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-muted-foreground">{prettyKey(k)}</div>
                    <div className="text-sm font-medium mt-0.5 break-words">{prettyVal(v)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No extra form answers were captured for this lead beyond the details above.
            </p>
          )}

          {lead.consent?.captured && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                <ShieldCheck className="h-4 w-4" /> TCPA consent captured
                <span className="ml-auto text-[11px] rounded-full bg-white border border-emerald-200 px-2 py-0.5 text-emerald-700">
                  Verified record
                </span>
              </div>
              <p className="mt-1.5 text-xs text-emerald-700/90">
                This lead agreed to be called and texted by a licensed agent, including by automated technology.
                {" "}
                {lead.consent.method}
                {lead.consent.ip ? ` · IP ${lead.consent.ip}` : ""}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
