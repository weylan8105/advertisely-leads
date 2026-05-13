import { Badge } from "@/components/ui/badge";
import type { LeadStatus, OrderStatus } from "@/types";

export function StatusBadge({ status }: { status: LeadStatus | OrderStatus | string }) {
  const map: Record<string, { variant: any; label: string }> = {
    New: { variant: "default", label: "New" },
    Contacted: { variant: "info", label: "Contacted" },
    "Appointment Set": { variant: "purple", label: "Appointment" },
    "No Answer": { variant: "warning", label: "No Answer" },
    "Bad Number": { variant: "destructive", label: "Bad Number" },
    Closed: { variant: "success", label: "Closed" },
    Replaced: { variant: "muted", label: "Replaced" },
    Pending: { variant: "muted", label: "Pending" },
    Processing: { variant: "info", label: "Processing" },
    Delivering: { variant: "warning", label: "Delivering" },
    Delivered: { variant: "success", label: "Delivered" },
    Refunded: { variant: "destructive", label: "Refunded" },
  };
  const cfg = map[status] ?? { variant: "muted", label: status };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
