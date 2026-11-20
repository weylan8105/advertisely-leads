"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface DayRange {
  from: string; // YYYY-MM-DD
  to: string;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The last 30 days, including today, in the viewer's calendar. */
export function defaultDayRange(): DayRange {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from: ymd(from), to: ymd(to) };
}

/** From/to date inputs for a custom range; nothing changes until Apply. */
export function CustomRangeInputs({
  value,
  onApply,
  className,
}: {
  value: DayRange;
  onApply: (v: DayRange) => void;
  className?: string;
}) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  useEffect(() => { setFrom(value.from); setTo(value.to); }, [value.from, value.to]);
  const today = ymd(new Date());
  const valid = !!from && !!to && from <= to;
  const changed = from !== value.from || to !== value.to;
  const input =
    "h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none";
  return (
    <form
      className={cn("flex flex-wrap items-center gap-2", className)}
      onSubmit={(e) => { e.preventDefault(); if (valid) onApply({ from, to }); }}
    >
      <label className="flex items-center gap-1.5 text-sm text-slate-600">
        From
        <input type="date" className={input} value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="flex items-center gap-1.5 text-sm text-slate-600">
        To
        <input type="date" className={input} value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
      </label>
      <button
        type="submit"
        disabled={!valid || !changed}
        className="h-9 rounded-md bg-slate-900 px-4 text-sm font-medium text-white disabled:opacity-40"
      >
        Apply
      </button>
      {!valid && from && to && <span className="text-xs text-red-600">Start date must be on or before the end date.</span>}
    </form>
  );
}

export const customRangeQuery = (r: DayRange) => `&from=${r.from}&to=${r.to}`;
