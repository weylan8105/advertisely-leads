"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Search, Database, RefreshCw } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { leadPackages } from "@/data/packages";
import { formatDate } from "@/lib/utils";

interface AdminLead {
  id: string; name: string; phone: string; email: string; state: string;
  occupation: string | null; income: number | null; packageName: string;
  status: string; source: string; receivedAt: string;
  assignedTo: { name: string | null; email: string } | null;
}
interface Counts { total: number; assigned: number; unassigned: number; }

export function AdminAllLeads() {
  const [leads, setLeads] = useState<AdminLead[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, assigned: 0, unassigned: 0 });
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigned, setAssigned] = useState("all");
  const [pkg, setPkg] = useState("all");
  const [source, setSource] = useState("all");
  const [search, setSearch] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (assigned !== "all") qs.set("assigned", assigned);
    if (pkg !== "all") qs.set("packageId", pkg);
    if (source !== "all") qs.set("source", source);
    if (search.trim()) qs.set("search", search.trim());
    fetch(`/api/admin/leads?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setLeads(d.leads ?? []);
        setCounts(d.counts ?? { total: 0, assigned: 0, unassigned: 0 });
        if (d.sources?.length) setSources(d.sources);
      })
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [assigned, pkg, source, search]);

  // Refetch on filter change (debounce the free-text search).
  useEffect(() => {
    const t = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  return (
    <div>
      {/* Count summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          ["Total in database", counts.total, "text-foreground"],
          ["Assigned / sold", counts.assigned, "text-emerald-600"],
          ["Unassigned", counts.unassigned, "text-amber-600"],
        ].map(([label, val, cls]) => (
          <div key={label as string} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className={`text-xl font-semibold ${cls}`}>{(val as number).toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, email, phone…" className="pl-9 h-9"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={assigned} onValueChange={setAssigned}>
          <SelectTrigger className="w-[150px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leads</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
          </SelectContent>
        </Select>
        <Select value={pkg} onValueChange={setPkg}>
          <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All packages</SelectItem>
            {leadPackages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {sources.length > 0 && (
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="hidden md:table-cell">Occupation</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead>Assigned to</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10">
                <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
              </TableCell></TableRow>
            ) : leads.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center py-10 text-sm text-muted-foreground">
                <Database className="h-5 w-5 mx-auto mb-2 opacity-40" />
                No leads match these filters.
              </TableCell></TableRow>
            ) : (
              leads.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>
                    <div className="font-medium text-sm">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{l.phone} · {l.email}</div>
                  </TableCell>
                  <TableCell><Badge variant="muted">{l.state || "—"}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{l.occupation ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{l.source}</TableCell>
                  <TableCell className="text-sm">
                    {l.assignedTo ? (
                      <span className="text-foreground">{l.assignedTo.name ?? l.assignedTo.email}</span>
                    ) : (
                      <Badge variant="warning">Unassigned</Badge>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="muted">{l.status}</Badge></TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {formatDate(new Date(l.receivedAt).toISOString())}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!loading && leads.length >= 200 && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing first 200 matches. Narrow the filters to see more specific results.
        </p>
      )}
    </div>
  );
}
