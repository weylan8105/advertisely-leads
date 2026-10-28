"use client";

import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { Input } from "@/components/ui/input";

// Local YYYY-MM-DD helpers (avoid UTC shifting the picked day).
const fmt = (d: Date) => {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
};
// A picked YYYY-MM-DD as the start / end of that day in the viewer's timezone.
const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};
const dayEnd = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999);
};

/**
 * Small, admin-only indicator of how many leads were delivered to the current
 * account's pipeline between two dates — for house/admin accounts that receive
 * leads without buying through Stripe. Render only for ADMIN users.
 */
export function DeliveredLeadsTracker() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const [from, setFrom] = useState(fmt(monthStart));
  const [to, setTo] = useState(fmt(today));
  const [count, setCount] = useState<number | null>(null);
  const [transferred, setTransferred] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Send exact local-day boundaries so the range matches the dates picked
    // (the server would otherwise read bare dates as UTC days).
    const qs = new URLSearchParams({ from: dayStart(from).toISOString(), to: dayEnd(to).toISOString() });
    fetch(`/api/leads/delivered-count?${qs}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (active) { setCount(d?.count ?? 0); setTransferred(d?.transferredExcluded ?? 0); } })
      .catch(() => { if (active) setCount(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [from, to]);

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-slate-200 bg-slate-50/60 px-4 py-2.5 text-sm">
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Inbox className="h-4 w-4" /> Delivered to your pipeline
      </span>
      <span className="tabular-nums text-base font-semibold text-foreground">
        {loading ? "…" : count === null ? "—" : count.toLocaleString()}
      </span>
      <span className="text-xs text-muted-foreground">leads between</span>
      <Input
        type="date"
        value={from}
        max={to}
        onChange={(e) => setFrom(e.target.value)}
        className="h-8 w-[140px]"
        aria-label="Delivered from"
      />
      <span className="text-xs text-muted-foreground">and</span>
      <Input
        type="date"
        value={to}
        min={from}
        onChange={(e) => setTo(e.target.value)}
        className="h-8 w-[140px]"
        aria-label="Delivered to"
      />
      <span className="inline-flex gap-1">
        {(
          [
            ["Last 7 days", () => { const d = new Date(); d.setDate(d.getDate() - 6); return fmt(d); }],
            ["This month", () => fmt(monthStart)],
          ] as const
        ).map(([label, start]) => (
          <button
            key={label}
            type="button"
            onClick={() => { setFrom(start()); setTo(fmt(new Date())); }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {label}
          </button>
        ))}
      </span>
      {!loading && transferred > 0 && (
        <span className="text-xs text-muted-foreground">
          · {transferred.toLocaleString()} transferred from other agents not counted
        </span>
      )}
    </div>
  );
}
