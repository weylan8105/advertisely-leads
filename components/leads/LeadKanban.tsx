"use client";
import Link from "next/link";
import { Phone, Mail, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Lead, LeadStatus } from "@/types";
import { formatDate } from "@/lib/utils";

const COLUMNS: { id: LeadStatus; label: string; color: string }[] = [
  { id: "New", label: "New", color: "bg-brand-red/15 text-brand-red" },
  { id: "Contacted", label: "Contacted", color: "bg-sky-500/15 text-sky-600" },
  { id: "Appointment Set", label: "Appointments", color: "bg-violet-500/15 text-violet-600" },
  { id: "No Answer", label: "No Answer", color: "bg-amber-500/15 text-amber-700" },
  { id: "Closed", label: "Closed", color: "bg-emerald-500/15 text-emerald-600" },
];

export function LeadKanban({ leads }: { leads: Lead[] }) {
  return (
    <div className="overflow-x-auto scrollbar-thin -mx-2 px-2 pb-2">
      <div className="inline-grid grid-flow-col auto-cols-[280px] gap-4 min-w-full">
        {COLUMNS.map((col) => {
          const colLeads = leads.filter((l) => l.status === col.id);
          return (
            <div key={col.id} className="flex flex-col h-full">
              <div className="flex items-center justify-between mb-3 px-1">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${col.color}`}>
                    {col.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{colLeads.length}</span>
                </div>
              </div>
              <div className="space-y-2 min-h-[200px] rounded-lg bg-slate-50 border border-dashed border-slate-200 p-2">
                {colLeads.map((lead) => (
                  <Link
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="block rounded-lg border border-slate-200 bg-white backdrop-blur-sm p-3 hover:border-brand-red/40 hover:bg-card transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-medium text-sm leading-tight">{lead.name}</div>
                      <span className="text-[10px] text-muted-foreground">{lead.state}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {lead.occupation}
                    </div>
                    {lead.tags?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {lead.tags.slice(0, 2).map((t) => (
                          <Badge key={t} variant="muted" className="text-[10px]">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 pt-2 border-t border-slate-200 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {formatDate(lead.receivedAt)}
                      </span>
                      <span className="flex gap-1.5">
                        <span className="inline-flex items-center gap-0.5">
                          <Phone className="h-3 w-3" />
                          {lead.callAttempts}
                        </span>
                        {lead.tasks?.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-brand-red">
                            <Mail className="h-3 w-3" />
                            {lead.tasks.filter((t) => !t.done).length}
                          </span>
                        )}
                      </span>
                    </div>
                  </Link>
                ))}
                {colLeads.length === 0 && (
                  <div className="text-center text-[11px] text-muted-foreground py-6">
                    No leads in this stage.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
