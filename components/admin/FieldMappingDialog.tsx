"use client";

import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, AlertTriangle, Wand2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const DB_FIELDS: { value: string; label: string }[] = [
  { value: "__ignore", label: "— Don't import —" },
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "state", label: "State" },
  { value: "age", label: "Age" },
  { value: "income", label: "Household income" },
  { value: "occupation", label: "Occupation / trade" },
  { value: "intentReason", label: "Intent / timeline" },
];

interface Question {
  key: string; label: string; type?: string;
  builtIn: boolean; autoField: string | null;
  mappedTo: string | null; suggested: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  mapping: { id: string; formId: string; formName: string; packageId: string; pageConnectionId: string };
}

export function FieldMappingDialog({ open, onOpenChange, mapping }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  // selection: question.key -> db field ("__ignore" means skip)
  const [sel, setSel] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(null); setSaved(false);
    fetch(`/api/admin/meta/forms/${encodeURIComponent(mapping.formId)}/questions`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
        return d;
      })
      .then((d) => {
        setQuestions(d.questions ?? []);
        const initial: Record<string, string> = {};
        for (const q of d.questions ?? []) {
          if (q.builtIn) continue;
          initial[q.key] = q.mappedTo ?? q.suggested ?? "__ignore";
        }
        setSel(initial);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, mapping.formId]);

  // Live required-field validation (name/phone/state from built-ins + selections).
  const covered = new Set<string>();
  for (const q of questions) if (q.autoField) covered.add(q.autoField);
  for (const [, f] of Object.entries(sel)) if (f && f !== "__ignore") covered.add(f);
  const missing = ["name", "phone", "state"].filter((f) => !covered.has(f));
  const custom = questions.filter((q) => !q.builtIn);
  const builtIns = questions.filter((q) => q.builtIn && q.autoField);

  async function save() {
    setSaving(true); setError(null);
    const fieldMapping: Record<string, string> = {};
    for (const [key, f] of Object.entries(sel)) {
      if (f && f !== "__ignore") fieldMapping[key] = f;
    }
    try {
      const res = await fetch("/api/admin/meta/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageConnectionId: mapping.pageConnectionId,
          formId: mapping.formId,
          formName: mapping.formName,
          packageId: mapping.packageId,
          fieldMapping,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSaved(true);
      setTimeout(() => onOpenChange(false), 900);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Field mapping — {mapping.formName}</DialogTitle>
          <DialogDescription>
            Map each Facebook form question to a database column. Built-in fields map
            automatically; set the custom questions below.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" /></div>
        ) : error ? (
          <div className="py-4">
            <p className="flex items-start gap-2 text-sm text-rose-600">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Validation banner */}
            <div className={`rounded-md border p-3 text-sm flex items-start gap-2 ${
              missing.length === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700"}`}>
              {missing.length === 0 ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
              {missing.length === 0
                ? <span>All required fields covered — leads from this form will map cleanly.</span>
                : <span>Missing required field{missing.length > 1 ? "s" : ""}: <strong>{missing.join(", ")}</strong>. Leads without these are skipped on ingestion.</span>}
            </div>

            {/* Built-in (auto) */}
            {builtIns.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Auto-mapped (built-in Facebook fields)</p>
                <div className="space-y-1">
                  {builtIns.map((q) => (
                    <div key={q.key} className="flex items-center justify-between text-xs rounded bg-slate-50 px-2.5 py-1.5">
                      <span className="text-muted-foreground truncate">{q.label || q.key}</span>
                      <Badge variant="success" className="text-[10px]">→ {q.autoField}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Custom questions */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Custom questions ({custom.length})</p>
              {custom.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">No custom questions on this form.</p>
              ) : (
                <div className="space-y-2">
                  {custom.map((q) => (
                    <div key={q.key} className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{q.label || q.key}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">{q.key}</div>
                      </div>
                      <Select value={sel[q.key] ?? "__ignore"} onValueChange={(v) => setSel((s) => ({ ...s, [q.key]: v }))}>
                        <SelectTrigger className="w-[190px] h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DB_FIELDS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {q.suggested && (sel[q.key] === "__ignore" || !sel[q.key]) && (
                        <button
                          title={`Suggest: ${q.suggested}`}
                          onClick={() => setSel((s) => ({ ...s, [q.key]: q.suggested! }))}
                          className="text-brand-red shrink-0"
                        >
                          <Wand2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          {saved ? (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Saved
            </span>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving || loading || !!error}>
                {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Save mapping"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
