import {
  PhoneCall,
  Mail,
  MessageSquare,
  StickyNote,
  Inbox,
  CalendarCheck,
  Send,
  Tag,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import type { LeadActivity, LeadNote } from "@/types";
import { formatDateTime, initials } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const typeMap: Record<LeadActivity["type"], { icon: any; color: string }> = {
  lead_received: { icon: Inbox, color: "text-brand-teal bg-brand-teal/10" },
  call_made: { icon: PhoneCall, color: "text-emerald-300 bg-emerald-500/10" },
  email_sent: { icon: Mail, color: "text-violet-300 bg-violet-500/10" },
  sms_sent: { icon: MessageSquare, color: "text-sky-300 bg-sky-500/10" },
  note_added: { icon: StickyNote, color: "text-amber-300 bg-amber-500/10" },
  status_changed: { icon: ArrowRight, color: "text-muted-foreground bg-white/5" },
  appointment_set: { icon: CalendarCheck, color: "text-violet-300 bg-violet-500/10" },
  exported_crm: { icon: Send, color: "text-sky-300 bg-sky-500/10" },
  tag_added: { icon: Tag, color: "text-muted-foreground bg-white/5" },
  replacement_requested: { icon: RefreshCw, color: "text-rose-300 bg-rose-500/10" },
};

interface ActivityTimelineProps {
  activity: LeadActivity[];
  notes: LeadNote[];
}

export function ActivityTimeline({ activity, notes }: ActivityTimelineProps) {
  // Merge notes into activity timeline
  const merged = [
    ...activity,
    ...notes.map(
      (n) =>
        ({
          id: n.id,
          type: "note_added" as const,
          author: n.author,
          body: n.body,
          at: n.at,
        }) satisfies LeadActivity,
    ),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  if (merged.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-white/10 bg-white/[0.01] p-4 text-xs text-muted-foreground text-center">
        No activity yet. Notes, calls, and exports will appear here.
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="absolute left-[15px] top-2 bottom-2 w-px bg-white/[0.06]" />
      <div className="space-y-4">
        {merged.map((event) => {
          const cfg = typeMap[event.type];
          const Icon = cfg.icon;
          return (
            <div key={event.id} className="relative flex gap-3">
              <div
                className={`relative z-10 h-8 w-8 grid place-items-center rounded-full shrink-0 ${cfg.color} ring-4 ring-card`}
              >
                <Icon className="h-3.5 w-3.5" />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  {event.author && (
                    <span className="text-xs font-medium">{event.author}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {formatDateTime(event.at)}
                  </span>
                </div>
                <div className="mt-1 text-sm">{event.body}</div>
              </div>
              {event.author && (
                <Avatar className="h-6 w-6 shrink-0 mt-1">
                  <AvatarFallback className="text-[9px]">
                    {initials(event.author)}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
