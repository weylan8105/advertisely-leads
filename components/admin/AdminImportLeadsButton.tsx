"use client";

import { useState } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Result = {
  ok?: boolean;
  error?: string;
  created?: number;
  updated?: number;
  assignedTotal?: number;
  orderQuantity?: number;
  orderStatus?: string;
  package?: string;
  client?: { name?: string; email?: string };
  warnings?: string[];
  offStateWarning?: string | null;
};

export function AdminImportLeadsButton() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csv, setCsv] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  function reset() {
    setEmail(""); setFileName(null); setCsv(""); setResult(null); setLoading(false);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
    setResult(null);
  }

  async function submit() {
    if (!email || !csv) return;
    setLoading(true); setResult(null);
    try {
      const res = await fetch("/api/admin/import-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, csv, commit: true }),
      });
      setResult(await res.json());
    } catch (err: any) {
      setResult({ error: err.message ?? "Import failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload className="h-4 w-4" /> Import leads (CSV)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Upload a client-ready CSV and assign it to a client&apos;s order. Leads appear in their
            dashboard immediately and the order is marked delivered.
          </DialogDescription>
        </DialogHeader>

        {result?.ok ? (
          <div className="py-2">
            <div className="flex items-center gap-2 text-emerald-600 mb-3">
              <CheckCircle2 className="h-5 w-5" />
              <span className="font-semibold">Import complete</span>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-muted-foreground">Client</span><span className="font-medium">{result.client?.name}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Package</span><span className="font-medium">{result.package}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">New leads created</span><span className="font-medium">{result.created}</span></div>
              {(result.updated ?? 0) > 0 && (
                <div className="flex justify-between"><span className="text-muted-foreground">Re-assigned (existing)</span><span className="font-medium">{result.updated}</span></div>
              )}
              <div className="flex justify-between"><span className="text-muted-foreground">Order fulfillment</span><span className="font-medium">{result.assignedTotal}/{result.orderQuantity} — {result.orderStatus}</span></div>
            </div>
            {result.offStateWarning && (
              <p className="mt-3 flex items-start gap-1.5 text-xs text-amber-600">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {result.offStateWarning}
              </p>
            )}
            <DialogFooter className="mt-4">
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="import-email">Client account email</Label>
              <Input
                id="import-email"
                type="email"
                placeholder="client@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                The email the client used to sign up. Leads assign to their most recent order.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="import-file">CSV file</Label>
              <label
                htmlFor="import-file"
                className="flex items-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm cursor-pointer hover:bg-slate-50"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className={fileName ? "text-foreground" : "text-muted-foreground"}>
                  {fileName ?? "Choose a .csv file…"}
                </span>
              </label>
              <input id="import-file" type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </div>

            {result?.error && (
              <p className="flex items-start gap-1.5 text-sm text-rose-600">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {result.error}
              </p>
            )}
            {result?.warnings && result.warnings.length > 0 && (
              <div className="rounded-md bg-amber-50 border border-amber-200 p-2.5 text-xs text-amber-700 max-h-24 overflow-y-auto">
                <p className="font-medium mb-1">{result.warnings.length} data warning(s):</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  {result.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
              <Button onClick={submit} disabled={loading || !email || !csv}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Importing…</> : <>Import &amp; deliver</>}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
