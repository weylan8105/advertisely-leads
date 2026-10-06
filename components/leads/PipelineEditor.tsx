"use client";

import { useState } from "react";
import { X, Loader2, Plus, Trash2, ArrowUp, ArrowDown, Lock, RotateCcw, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  STAGE_TONES,
  WON_STAGE_ID,
  INTAKE_STAGE_ID,
  isReservedStage,
  MAX_STAGES,
  MAX_STAGE_LABEL_LEN,
  type PipelineStage,
  type StageTone,
} from "@/data/pipeline";
import { cn } from "@/lib/utils";

type Row = PipelineStage & { key: string };

let KEY = 0;
const withKeys = (stages: PipelineStage[]): Row[] =>
  stages.map((s) => ({ ...s, key: `k${KEY++}` }));

const TONE_DOT: Record<string, string> = Object.fromEntries(STAGE_TONES.map((t) => [t.value, t.dot]));

export function PipelineEditor({
  stages: initial,
  onClose,
  onSaved,
}: {
  stages: PipelineStage[];
  onClose: () => void;
  onSaved: (stages: PipelineStage[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => withKeys(initial));
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function update(key: string, patch: Partial<Row>) {
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }
  function remove(key: string) {
    setRows((cur) => cur.filter((r) => r.key !== key));
  }
  function moveRow(idx: number, dir: -1 | 1) {
    setRows((cur) => {
      const next = [...cur];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return cur;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  }
  function addRow() {
    setRows((cur) =>
      cur.length >= MAX_STAGES ? cur : [...cur, { key: `k${KEY++}`, id: "", label: "", tone: "slate" }],
    );
  }

  async function save() {
    setError(null);
    // Blank custom rows are dropped; a blank reserved row keeps its current
    // text (the server re-inserts the anchor with its default label if needed).
    const cleaned = rows
      .map((r) => ({ id: r.id, label: r.label.trim(), tone: r.tone }))
      .filter((r) => r.label.length > 0);
    if (cleaned.length < 2) {
      setError("Keep at least two stages, each with a name.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/pipeline/stages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages: cleaned }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save stages");
      onSaved(data.stages as PipelineStage[]);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Could not save stages");
    } finally {
      setSaving(false);
    }
  }

  async function resetDefaults() {
    if (!window.confirm("Reset your pipeline to the default stages? Your custom columns will be removed.")) return;
    setResetting(true);
    setError(null);
    try {
      const res = await fetch("/api/pipeline/stages", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not reset");
      onSaved(data.stages as PipelineStage[]);
      onClose();
    } catch (e: any) {
      setError(e.message ?? "Could not reset");
    } finally {
      setResetting(false);
    }
  }

  const busy = saving || resetting;

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onClick={busy ? undefined : onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg flex flex-col max-h-[88vh]">
        <div className="flex items-start justify-between gap-3 p-6 pb-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Customize your pipeline</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Rename stages, pick colors, reorder, and add or remove columns so the CRM matches how
              you run your business.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground shrink-0 disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 overflow-y-auto scrollbar-thin flex-1 space-y-2">
          {rows.map((r, idx) => {
            const reserved = isReservedStage(r.id);
            const role =
              r.id === INTAKE_STAGE_ID ? "New leads arrive here" : r.id === WON_STAGE_ID ? "Counts as a sale 💰" : null;
            return (
              <div
                key={r.key}
                className={cn(
                  "flex items-center gap-2 rounded-lg border p-2",
                  reserved ? "border-slate-200 bg-slate-50/70" : "border-slate-200",
                )}
              >
                <GripVertical className="h-4 w-4 text-slate-300 shrink-0" />

                {/* Color picker */}
                <div className="flex items-center gap-1 shrink-0">
                  {STAGE_TONES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      title={t.label}
                      onClick={() => update(r.key, { tone: t.value as StageTone })}
                      className={cn(
                        "h-4 w-4 rounded-full transition-transform",
                        t.dot,
                        r.tone === t.value ? "ring-2 ring-offset-1 ring-slate-500 scale-110" : "opacity-60 hover:opacity-100",
                      )}
                    />
                  ))}
                </div>

                {/* Label */}
                <div className="flex-1 min-w-0">
                  <input
                    value={r.label}
                    onChange={(e) => update(r.key, { label: e.target.value.slice(0, MAX_STAGE_LABEL_LEN) })}
                    placeholder="Stage name"
                    className="w-full h-9 rounded-md border border-slate-200 px-2.5 text-sm focus:border-brand-red/50 focus:outline-none"
                  />
                  {role && (
                    <div className="mt-0.5 pl-0.5 text-[10px] font-medium text-muted-foreground inline-flex items-center gap-1">
                      <Lock className="h-2.5 w-2.5" /> {role}
                    </div>
                  )}
                </div>

                {/* Reorder */}
                <div className="flex flex-col shrink-0">
                  <button
                    type="button"
                    onClick={() => moveRow(idx, -1)}
                    disabled={idx === 0}
                    className="text-slate-400 hover:text-foreground disabled:opacity-30"
                    aria-label="Move up"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveRow(idx, 1)}
                    disabled={idx === rows.length - 1}
                    className="text-slate-400 hover:text-foreground disabled:opacity-30"
                    aria-label="Move down"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Delete (reserved stages can't be removed) */}
                {reserved ? (
                  <span className="shrink-0 w-7 grid place-items-center text-slate-300" title="Required stage — can't be deleted">
                    <Lock className="h-4 w-4" />
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => remove(r.key)}
                    className="shrink-0 w-7 grid place-items-center text-slate-400 hover:text-rose-600"
                    aria-label="Delete stage"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addRow}
            disabled={rows.length >= MAX_STAGES}
            className="w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm text-muted-foreground hover:border-brand-red/40 hover:text-brand-red disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="h-4 w-4" /> Add stage
          </button>
        </div>

        {error && <p className="px-6 pt-3 text-sm text-rose-600">{error}</p>}

        <div className="flex items-center justify-between gap-3 p-6 pt-4 border-t border-slate-100 mt-3">
          <button
            onClick={resetDefaults}
            disabled={busy}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Reset to default
          </button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={busy}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save pipeline
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
