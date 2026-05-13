"use client";
import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { mockLeads } from "@/data/leads";
import { formatDateTime } from "@/lib/utils";

const agents = ["Jordan Pace", "Sam Vega", "Marina Coyle", "Auto-assign"];

export function AdminLeadQueue() {
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const unassigned = mockLeads.slice(0, 8);

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox />
            </TableHead>
            <TableHead>Lead</TableHead>
            <TableHead className="hidden md:table-cell">Type</TableHead>
            <TableHead className="hidden md:table-cell">State</TableHead>
            <TableHead className="hidden lg:table-cell">Source</TableHead>
            <TableHead className="hidden lg:table-cell">Received</TableHead>
            <TableHead>Assign to</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {unassigned.map((lead) => (
            <TableRow key={lead.id}>
              <TableCell>
                <Checkbox />
              </TableCell>
              <TableCell>
                <div className="font-medium">{lead.name}</div>
                <div className="text-xs text-muted-foreground">{lead.phone}</div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <Badge variant="muted">{lead.leadTypeLabel}</Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell">{lead.state}</TableCell>
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[200px] truncate">
                {lead.source}
              </TableCell>
              <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                {formatDateTime(lead.receivedAt)}
              </TableCell>
              <TableCell>
                <Select
                  value={assignments[lead.id] ?? ""}
                  onValueChange={(v) => setAssignments({ ...assignments, [lead.id]: v })}
                >
                  <SelectTrigger className="h-8 w-[160px]">
                    <SelectValue placeholder="Pick agent" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a} value={a}>
                        {a}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline">
                  Disperse
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
