"use client";

import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Lead } from "@/types";

function inMinutes(min: number) {
  const d = new Date();
  d.setMinutes(d.getMinutes() + min);
  return d;
}
function tomorrow9am() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function toLocalInput(d: Date) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function CallbackModal({
  lead,
  onClose,
  onSaved,
}: {
  lead: Lead;
  onClose: () => void;
  onSaved: (iso: string | null) => void;
}) {
  const [exact, setExact] = useState(lead.callbackAt ? toLocalInput(new Date(lead.callbackAt)) : "");
  const [saving, setSaving] = useState(false);

  async function save(when: Date | null) {
    setSaving(true);
    const iso = when ? when.toISOString() : null;
    const res = await fetch(`/api/leads/${lead.id}/callback`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callbackAt: iso }),
    });
    setSaving(false);
    if (res.ok) {
      onSaved(iso);
      onClose();
    } else {
      alert((await res.json().catch(() => ({}))).error ?? "Could not save callback");
    }
  }

  const quick: [string, Date][] = [
    ["In 30 min", inMinutes(30)],
    ["In 1 hour", inMinutes(60)],
    ["In 3 hours", inMinutes(180)],
    ["Tomorrow 9 AM", tomorrow9am()],
  ];

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Callback — {lead.name}</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Pick when to call back. The card counts down and flashes red when it&apos;s time.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {quick.map(([label, when]) => (
            <button
              key={label}
              onClick={() => save(when)}
              disabled={saving}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm hover:border-brand-red/40 hover:bg-brand-red/[0.03] disabled:opacity-50"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="text-sm text-muted-foreground">Or pick an exact time</label>
          <input
            type="datetime-local"
            value={exact}
            onChange={(e) => setExact(e.target.value)}
            className="mt-1 w-full h-10 rounded-md border border-slate-200 px-3 text-sm"
          />
        </div>

        <div className="mt-5 flex items-center justify-between">
          {lead.callbackAt ? (
            <button onClick={() => save(null)} disabled={saving} className="text-sm text-rose-600 hover:underline">
              Clear reminder
            </button>
          ) : (
            <button onClick={onClose} className="text-sm text-muted-foreground hover:underline">
              Skip for now
            </button>
          )}
          <Button onClick={() => save(exact ? new Date(exact) : null)} disabled={saving || !exact}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
