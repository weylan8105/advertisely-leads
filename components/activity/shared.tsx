"use client";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export type Period = "today" | "wtd" | "mtd" | "ytd" | "all";

export interface ActivityStats {
  leads: number;
  dials: number;
  contacts: number;
  appointments: number;
  presentations: number;
  policies: number;
  apCents: number;
}

const PERIOD_LABELS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "wtd", label: "WTD" },
  { id: "mtd", label: "MTD" },
  { id: "ytd", label: "YTD" },
  { id: "all", label: "All" },
];

/** Rounded pill toggle group (Today / WTD / MTD / YTD / All, metric tabs, …). */
export function Pills<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
            value === o.id
              ? "border-slate-900 bg-slate-900 text-white"
              : "border-slate-200 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PeriodPills({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <Pills value={value} onChange={onChange} options={PERIOD_LABELS} />;
}

export function formatAp(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(
    Math.round(cents / 100),
  );
}

/** "40%" — share of `part` in `whole`; 0% when there's nothing to divide by. */
export function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

export function PersonAvatar({ name, image, className }: { name: string; image: string | null; className?: string }) {
  return (
    <Avatar className={className}>
      {image && <AvatarImage src={image} alt="" />}
      <AvatarFallback>{initials(name)}</AvatarFallback>
    </Avatar>
  );
}
