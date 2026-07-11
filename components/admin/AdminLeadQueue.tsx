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
import { Inbox } from "lucide-react";

const agents = ["Jordan Pace", "Sam Vega", "Marina Coyle", "Auto-assign"];

export function AdminLeadQueue() {
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  // Real leads will come from the database via Stripe orders + Meta webhook
  const unassigned: any[] = [];

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
          {unassigned.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Inbox className="h-8 w-8 opacity-30" />
                  <p className="text-sm font-medium">No unassigned leads</p>
                  <p className="text-xs">
                    Leads will appear here once your Stripe webhook and Meta integration are configured.
                  </p>
                </div>
              </TableCell>
            </TableRow>
          ) : (
            unassigned.map((lead) => (
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
                  {lead.receivedAt}
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
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
