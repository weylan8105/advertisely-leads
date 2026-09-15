"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Trash2, RotateCcw, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

interface TrashLead {
  id: string;
  name: string;
  state: string;
  occupation: string | null;
  packageId: string;
  disposition: string | null;
  trashedAt: string | null;
  deletesInDays: number | null;
}

/**
 * Admin recycle-bin. Lists trashed (replaced/bad) leads that are excluded from
 * all sellable inventory and auto-purged after the retention window. Admins can
 * restore a lead to the pool or empty the bin now.
 */
export function TrashQueue() {
  const [leads, setLeads] = useState<TrashLead[]>([]);
  const [retentionDays, setRetentionDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/trash")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setLeads(d.leads ?? []);
        if (d.retentionDays) setRetentionDays(d.retentionDays);
      })
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function restore(id: string) {
    setBusy(id);
    try {
      await fetch("/api/admin/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", leadId: id }),
      });
      setLeads((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setBusy(null);
    }
  }

  async function emptyNow() {
    if (!confirm(`Permanently delete leads that have been in the trash more than ${retentionDays} days? This cannot be undone.`)) return;
    setBusy("empty");
    try {
      const res = await fetch("/api/admin/trash", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "empty" }),
      });
      const d = await res.json();
      alert(`Purged ${d.purged ?? 0} lead(s) past ${retentionDays} days.`);
      load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <p className="text-sm text-muted-foreground">
          Replaced/bad leads live here. They are <strong>never sold</strong> and are automatically deleted{" "}
          <strong>{retentionDays} days</strong> after being trashed. {leads.length} in trash.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-rose-600 border-rose-300 hover:bg-rose-50"
            onClick={emptyNow}
            disabled={busy === "empty" || leads.length === 0}
          >
            {busy === "empty" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Empty past {retentionDays}d
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading trash…
        </div>
      ) : leads.length === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">Trash is empty.</div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Lead</TableHead>
                <TableHead>State</TableHead>
                <TableHead className="hidden md:table-cell">Trade</TableHead>
                <TableHead className="hidden md:table-cell">Reason</TableHead>
                <TableHead>Auto-deletes</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell>{l.state}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{l.occupation ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{l.disposition ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {l.deletesInDays === 0 ? "next run" : `in ${l.deletesInDays}d`}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => restore(l.id)}
                      disabled={busy === l.id}
                      title="Restore to available pool"
                    >
                      {busy === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      Restore
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
