"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  RefreshCw,
  MoreHorizontal,
  Search,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "./StatusBadge";
import { ExportButton } from "./ExportButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Lead } from "@/types";
import { formatDate } from "@/lib/utils";
import { leadStatuses } from "@/data/leads";

interface LeadTableProps {
  leads: Lead[];
  showBulk?: boolean;
  compact?: boolean;
}

export function LeadTable({ leads, showBulk = true, compact = false }: LeadTableProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch =
        !search ||
        [l.name, l.email, l.phone, l.state, l.occupation, l.id]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || l.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [leads, search, statusFilter]);

  const allSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));

  const toggleAll = () => {
    const next = new Set(selected);
    if (allSelected) {
      filtered.forEach((l) => next.delete(l.id));
    } else {
      filtered.forEach((l) => next.add(l.id));
    }
    setSelected(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  return (
    <div className="space-y-4">
      {!compact && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, email, ID…"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[170px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {leadStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select defaultValue="any-state">
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any-state">Any state</SelectItem>
                <SelectItem value="tx">TX</SelectItem>
                <SelectItem value="fl">FL</SelectItem>
                <SelectItem value="ca">CA</SelectItem>
                <SelectItem value="ny">NY</SelectItem>
                <SelectItem value="ga">GA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2">
            {selected.size > 0 && (
              <>
                <Button variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4" />
                  Request replacement ({selected.size})
                </Button>
              </>
            )}
            <ExportButton count={selected.size > 0 ? selected.size : undefined} />
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {showBulk && (
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                </TableHead>
              )}
              <TableHead>Lead</TableHead>
              <TableHead className="hidden md:table-cell">Type</TableHead>
              <TableHead className="hidden md:table-cell">State</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden lg:table-cell">Source</TableHead>
              <TableHead className="hidden lg:table-cell">Consent</TableHead>
              <TableHead className="hidden md:table-cell">Received</TableHead>
              <TableHead className="hidden xl:table-cell">Agent</TableHead>
              <TableHead className="w-12"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((lead) => (
              <TableRow key={lead.id} className="cursor-pointer">
                {showBulk && (
                  <TableCell>
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/leads/${lead.id}`} className="block">
                    <div className="font-medium leading-tight">{lead.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {lead.phone} · {lead.email}
                    </div>
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant="muted">{lead.leadTypeLabel}</Badge>
                </TableCell>
                <TableCell className="hidden md:table-cell">{lead.state}</TableCell>
                <TableCell>
                  <StatusBadge status={lead.status} />
                </TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                  {lead.source}
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  {lead.consent.captured ? (
                    <Badge variant="success">{lead.consent.method}</Badge>
                  ) : (
                    <Badge variant="destructive">Missing</Badge>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatDate(lead.receivedAt)}
                </TableCell>
                <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                  {lead.assignedAgent ?? "—"}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link href={`/leads/${lead.id}`}>
                          View details <ChevronRight className="h-3 w-3 ml-auto" />
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem>Change status</DropdownMenuItem>
                      <DropdownMenuItem>Add note</DropdownMenuItem>
                      <DropdownMenuItem>Push to CRM</DropdownMenuItem>
                      <DropdownMenuItem>Request replacement</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-12">
                  No leads match your filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
