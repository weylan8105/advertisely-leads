"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, Search, Database, RefreshCw, X } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { leadPackages } from "@/data/packages";
import { formatDate, cn } from "@/lib/utils";

interface AdminLead {
  id: string; name: string; phone: string; email: string; state: string;
  age: number | null; occupation: string | null; income: number | null; packageName: string;
  status: string; source: string; campaignName: string | null; receivedAt: string;
  assignedTo: { name: string | null; email: string } | null;
}
interface Counts { total: number; assigned: number; unassigned: number; }

const DEFAULTS = {
  pkg: "all", source: "all", campaign: "all", occupation: "all",
  dateFrom: "", dateTo: "", ageMin: "", ageMax: "", incomeMin: "", search: "",
};

export function AdminAllLeads({
  assigned: assignedProp,
  onAssignedChange,
}: {
  /** Controlled "in a CRM" filter (all | assigned | unassigned). Falls back to internal state. */
  assigned?: string;
  onAssignedChange?: (v: string) => void;
} = {}) {
  const [leads, setLeads] = useState<AdminLead[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, assigned: 0, unassigned: 0 });
  const [matched, setMatched] = useState(0);
  const [sources, setSources] = useState<string[]>([]);
  const [campaigns, setCampaigns] = useState<string[]>([]);
  const [occupations, setOccupations] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Assignment filter can be driven by the dashboard cards (controlled) or on its own.
  const [assignedInternal, setAssignedInternal] = useState("all");
  const assigned = assignedProp ?? assignedInternal;
  const setAssigned = (v: string) => (onAssignedChange ? onAssignedChange(v) : setAssignedInternal(v));

  const [f, setF] = useState({ ...DEFAULTS });
  const set = (k: keyof typeof DEFAULTS, v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const clear = () => { setF({ ...DEFAULTS }); setAssigned("all"); };

  const load = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (assigned !== "all") qs.set("assigned", assigned);
    if (f.pkg !== "all") qs.set("packageId", f.pkg);
    if (f.source !== "all") qs.set("source", f.source);
    if (f.campaign !== "all") qs.set("campaign", f.campaign);
    if (f.occupation !== "all") qs.set("occupation", f.occupation);
    if (f.dateFrom) qs.set("dateFrom", f.dateFrom);
    if (f.dateTo) qs.set("dateTo", f.dateTo);
    if (f.ageMin) qs.set("ageMin", f.ageMin);
    if (f.ageMax) qs.set("ageMax", f.ageMax);
    if (f.incomeMin) qs.set("incomeMin", f.incomeMin);
    if (f.search.trim()) qs.set("search", f.search.trim());
    fetch(`/api/admin/leads?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setLeads(d.leads ?? []);
        setCounts(d.counts ?? { total: 0, assigned: 0, unassigned: 0 });
        setMatched(d.matched ?? (d.leads?.length ?? 0));
        if (d.sources?.length) setSources(d.sources);
        if (d.campaigns?.length) setCampaigns(d.campaigns);
        if (d.occupations?.length) setOccupations(d.occupations);
      })
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  }, [f, assigned]);

  // Refetch on filter change (debounce the free-text search).
  useEffect(() => {
    const t = setTimeout(load, f.search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, f.search]);

  const filtersActive = JSON.stringify(f) !== JSON.stringify(DEFAULTS) || assigned !== "all";

  return (
    <div>
      {/* Count summary — click a card to filter the table by CRM status. */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: "Total in database", val: counts.total, value: "all", numCls: "text-foreground",
            active: "border-slate-800 ring-2 ring-slate-800/25 bg-slate-50" },
          { label: "Not in a CRM", val: counts.unassigned, value: "unassigned", numCls: "text-amber-600",
            active: "border-amber-500 ring-2 ring-amber-500/30 bg-amber-50" },
          { label: "In a CRM (sold)", val: counts.assigned, value: "assigned", numCls: "text-emerald-600",
            active: "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-50" },
        ].map((c) => {
          const on = assigned === c.value;
          return (
            <button
              key={c.value}
              onClick={() => setAssigned(c.value)}
              className={cn(
                "text-left rounded-lg border p-3 transition-all",
                on ? c.active : "border-slate-200 bg-white hover:border-slate-300",
              )}
            >
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                {c.label}
                {on && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/85 text-white text-[9px] font-medium px-1.5 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Filtering
                  </span>
                )}
              </div>
              <div className={cn("text-xl font-semibold", c.numCls)}>{c.val.toLocaleString()}</div>
            </button>
          );
        })}
      </div>

      {/* Filters — row 1: search + CRM status + actions */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, email, phone…" className="pl-9 h-9"
            value={f.search} onChange={(e) => set("search", e.target.value)} />
        </div>
        <Select value={assigned} onValueChange={setAssigned}>
          <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All leads</SelectItem>
            <SelectItem value="unassigned">Not in a CRM</SelectItem>
            <SelectItem value="assigned">In a CRM</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={clear}>
            <X className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      {/* Filters — row 2: category dropdowns */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <Select value={f.pkg} onValueChange={(v) => set("pkg", v)}>
          <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Package" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All packages</SelectItem>
            {leadPackages.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {campaigns.length > 0 && (
          <Select value={f.campaign} onValueChange={(v) => set("campaign", v)}>
            <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Campaign" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All campaigns</SelectItem>
              {campaigns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {occupations.length > 0 && (
          <Select value={f.occupation} onValueChange={(v) => set("occupation", v)}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Occupation" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All occupations</SelectItem>
              {occupations.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {sources.length > 0 && (
          <Select value={f.source} onValueChange={(v) => set("source", v)}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Source" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Filters — row 3: date generated + age + income ranges */}
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <div>
          <Label className="text-[11px] text-muted-foreground">Generated from</Label>
          <Input type="date" className="h-9 w-[150px]" value={f.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Generated to</Label>
          <Input type="date" className="h-9 w-[150px]" value={f.dateTo} onChange={(e) => set("dateTo", e.target.value)} />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Age min</Label>
          <Input type="number" min={0} placeholder="18" className="h-9 w-[80px]" value={f.ageMin} onChange={(e) => set("ageMin", e.target.value)} />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Age max</Label>
          <Input type="number" min={0} placeholder="65" className="h-9 w-[80px]" value={f.ageMax} onChange={(e) => set("ageMax", e.target.value)} />
        </div>
        <div>
          <Label className="text-[11px] text-muted-foreground">Min income ($)</Label>
          <Input type="number" min={0} placeholder="any" className="h-9 w-[110px]" value={f.incomeMin} onChange={(e) => set("incomeMin", e.target.value)} />
        </div>
      </div>

      <div className="mb-2 text-xs text-muted-foreground">
        {loading ? "Loading…" : <><span className="font-medium text-foreground">{matched.toLocaleString()}</span> lead{matched === 1 ? "" : "s"} match these filters</>}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-200 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Lead</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="hidden md:table-cell">Occupation</TableHead>
              <TableHead className="hidden lg:table-cell">Age</TableHead>
              <TableHead className="hidden lg:table-cell">Campaign</TableHead>
              <TableHead className="hidden xl:table-cell">Source</TableHead>
              <TableHead>CRM</TableHead>
              <TableHead className="hidden md:table-cell">Generated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-10">
                <Loader2 className="h-5 w-5 animate-spin inline text-muted-foreground" />
              </TableCell></TableRow>
            ) : leads.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
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
                  <TableCell className="hidden lg:table-cell text-sm">{l.age ?? "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{l.campaignName ?? "—"}</TableCell>
                  <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">{l.source}</TableCell>
                  <TableCell className="text-sm">
                    {l.assignedTo ? (
                      <span className="text-foreground">{l.assignedTo.name ?? l.assignedTo.email}</span>
                    ) : (
                      <Badge variant="warning">Not in a CRM</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                    {formatDate(new Date(l.receivedAt).toISOString())}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {!loading && matched > leads.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the {leads.length.toLocaleString()} most recent of {matched.toLocaleString()} matches. Narrow the filters (or a date range) to see the rest.
        </p>
      )}
    </div>
  );
}
