"use client";
import Link from "next/link";
import {
  Phone,
  Mail,
  MessageSquare,
  Calendar,
  Clock,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import type { LeadTask } from "@/types";
import { formatDateTime } from "@/lib/utils";
import { cn } from "@/lib/utils";

const typeMap: Record<LeadTask["type"], { icon: any; color: string; label: string }> = {
  call: { icon: Phone, color: "text-emerald-300 bg-emerald-500/10", label: "Call" },
  email: { icon: Mail, color: "text-violet-300 bg-violet-500/10", label: "Email" },
  sms: { icon: MessageSquare, color: "text-sky-300 bg-sky-500/10", label: "SMS" },
  appointment: { icon: Calendar, color: "text-amber-300 bg-amber-500/10", label: "Appointment" },
  follow_up: { icon: Clock, color: "text-brand-teal bg-brand-teal/10", label: "Follow-up" },
};

interface TaskListProps {
  tasks: LeadTask[];
  showLead?: boolean;
  emptyHint?: string;
}

export function TaskList({ tasks, showLead = true, emptyHint }: TaskListProps) {
  const [doneOverrides, setDoneOverrides] = useState<Record<string, boolean>>({});

  const ordered = [...tasks].sort((a, b) => {
    const aDone = doneOverrides[a.id] ?? a.done;
    const bDone = doneOverrides[b.id] ?? b.done;
    if (aDone !== bDone) return aDone ? 1 : -1;
    return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
  });

  if (ordered.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-white/10 bg-white/[0.01] p-6 text-xs text-muted-foreground text-center">
        <CheckCircle2 className="h-5 w-5 mx-auto mb-2 text-brand-teal" />
        {emptyHint ?? "No upcoming tasks. You're clear."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {ordered.map((task) => {
        const cfg = typeMap[task.type];
        const Icon = cfg.icon;
        const done = doneOverrides[task.id] ?? task.done;
        const overdue = !done && new Date(task.dueAt) < new Date();
        return (
          <div
            key={task.id}
            className={cn(
              "rounded-lg border bg-white/[0.02] p-3 flex items-start gap-3 transition-all",
              done
                ? "border-white/[0.04] opacity-50"
                : overdue
                ? "border-rose-500/30 bg-rose-500/[0.04]"
                : "border-white/[0.08]",
            )}
          >
            <Checkbox
              checked={done}
              onCheckedChange={() =>
                setDoneOverrides({ ...doneOverrides, [task.id]: !done })
              }
              className="mt-1"
            />
            <div className={cn("h-8 w-8 grid place-items-center rounded-md shrink-0", cfg.color)}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="muted" className="text-[10px]">
                  {cfg.label}
                </Badge>
                {overdue && (
                  <Badge variant="destructive" className="text-[10px]">
                    Overdue
                  </Badge>
                )}
                <span
                  className={cn(
                    "text-sm font-medium leading-tight",
                    done && "line-through",
                  )}
                >
                  {task.title}
                </span>
              </div>
              {showLead && (
                <Link
                  href={`/leads/${task.leadId}`}
                  className="text-[11px] text-muted-foreground hover:text-brand-teal inline-flex items-center gap-0.5 mt-1"
                >
                  {task.leadName} <ChevronRight className="h-3 w-3" />
                </Link>
              )}
              <div className="text-[11px] text-muted-foreground mt-1">
                Due {formatDateTime(task.dueAt)} · {task.assignedTo}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
