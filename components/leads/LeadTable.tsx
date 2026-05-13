"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronRight,
  RefreshCw,
  MoreHorizontal,
  Search,
  Phone,
  Mail,
  MessageSquare,
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
        [l.name, l.email, l.phone, l.state, l.occupation, l.id, ...(l.tags ?? [])]
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
                placeholder="Search name, phone, email, tag, ID…"
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
              <Button variant="outline" size="sm">
                <RefreshCw className="h-4 w-4" />
                Request replacement ({selected.size})
              </Button>
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
              <TableHead className="hidden lg:table-cell">Tags</TableHead>
              <TableHead className="hidden md:table-cell">State</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden xl:table-cell">Source</TableHead>
              <TableHead className="hidden md:table-cell">Received</TableHead>
              <TableHead className="hidden xl:table-cell">Agent</TableHead>
              <TableHead className="text-right">Quick actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((lead) => (
              <TableRow key={lead.id}>
                {showBulk && (
                  <TableCell>
                    <Checkbox
                      checked={selected.has(lead.id)}
                      onCheckedChange={() => toggle(lead.id)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Link href={`/leads/${lead.id}`} className="block group">
                    <div className="font-medium leading-tight group-hover:text-brand-teal transition-colors">
                      {lead.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {lead.phone} · {lead.email}
                    </div>
                  </Link>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <div className="flex flex-wrap gap-1 max-w-[220px]">
                    {(lead.tags ?? []).slice(0, 2).map((t) => (
                      <Badge key={t} variant="muted" className="text-[10px]">
                        {t}
                      </Badge>
                    ))}
                    {(lead.tags?.length ?? 0) > 2 && (
                      <Badge variant="muted" className="text-[10px]">
                        +{(lead.tags?.length ?? 0) - 2}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">{lead.state}</TableCell>
                <TableCell>
                  <StatusBadge status={lead.status} />
                </TableCell>
                <TableCell className="hidden xl:table-cell text-xs text-muted-foreground max-w-[180px] truncate">
                  {lead.source}
                </TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {formatDate(lead.receivedAt)}
                </TableCell>
                <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                  {lead.assignedAgent ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex items-center gap-1">
                    <a
                      href={`tel:${lead.phone.replace(/\D/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Call"
                      className="h-7 w-7 grid place-items-center rounded-md border border-white/10 hover:bg-emerald-500/10 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`sms:${lead.phone.replace(/\D/g, "")}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Text"
                      className="h-7 w-7 grid place-items-center rounded-md border border-white/10 hover:bg-sky-500/10 hover:border-sky-500/40 hover:text-sky-300 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={`mailto:${lead.email}`}
                      onClick={(e) => e.stopPropagation()}
                      title="Email"
                      className="h-7 w-7 grid place-items-center rounded-md border border-white/10 hover:bg-violet-500/10 hover:border-violet-500/40 hover:text-violet-300 transition-colors"
                    >
                      <Mail className="h-3.5 w-3.5" />
                    </a>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/leads/${lead.id}`}>
                            View details <ChevronRight className="h-3 w-3 ml-auto" />
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem>Log call disposition</DropdownMenuItem>
                        <DropdownMenuItem>Add task / reminder</DropdownMenuItem>
                        <DropdownMenuItem>Change status</DropdownMenuItem>
                        <DropdownMenuItem>Add note</DropdownMenuItem>
                        <DropdownMenuItem>Push to CRM</DropdownMenuItem>
                        <DropdownMenuItem>Request replacement</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
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
