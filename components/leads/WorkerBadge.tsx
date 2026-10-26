"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TeamMember {
  userId: string;
  name: string | null;
  email: string | null;
  isSelf?: boolean;
}

export function initialsOf(m: { name?: string | null; email?: string | null } | null | undefined): string {
  const src = (m?.name || m?.email?.split("@")[0] || "").trim();
  if (!src) return "?";
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  const s = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return s.toUpperCase();
}

// Stable color per person so the same teammate always looks the same on every card.
const COLORS = [
  "bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-amber-600",
  "bg-rose-600", "bg-cyan-600", "bg-indigo-600", "bg-teal-600", "bg-fuchsia-600",
];
export function colorFor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** The little circle in a card's corner: the worker's initials, or a dashed "nobody" ring. */
export function WorkerBadge({
  member,
  workingUserId,
  onClick,
}: {
  member: TeamMember | null;
  workingUserId?: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const label = workingUserId
    ? `Worked by ${member?.name || member?.email || "a former teammate"} · click to change`
    : "Nobody is working this lead · click to claim it";
  return (
    <button
      type="button"
      onClick={onClick}
      // Keep the open picker's outside-click handler from firing, so a second click toggles it shut.
      onMouseDown={(e) => e.stopPropagation()}
      title={label}
      aria-label={label}
      className={cn(
        "shrink-0 grid place-items-center h-6 w-6 rounded-full text-[10px] font-semibold leading-none transition-shadow",
        workingUserId
          ? cn("text-white hover:ring-2 hover:ring-offset-1 hover:ring-slate-300", colorFor(workingUserId))
          : "border border-dashed border-slate-300 text-slate-400 hover:border-brand-red/50 hover:text-brand-red",
      )}
    >
      {workingUserId ? initialsOf(member) : <UserRound className="h-3.5 w-3.5" />}
    </button>
  );
}

/**
 * Dropdown of teammates, pinned to the badge with fixed positioning so a
 * column's scroll container can't clip it. Closes on outside click, Esc, or when
 * the board/page scrolls (the badge moves away) — but scrolling the list itself
 * keeps it open.
 */
export function WorkerPicker({
  anchor,
  members,
  workingUserId,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  members: TeamMember[];
  workingUserId?: string;
  onPick: (userId: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onScroll(e: Event) {
      if (ref.current && ref.current.contains(e.target as Node)) return; // scrolling the list
      onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const WIDTH = 240;
  const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
  const below = anchor.bottom + 6;
  // Open downward unless there's clearly more room above; size to the room available.
  const roomBelow = window.innerHeight - below - 12;
  const roomAbove = anchor.top - 18;
  const flip = roomBelow < 260 && roomAbove > roomBelow;
  const maxH = Math.max(180, Math.min(420, flip ? roomAbove : roomBelow));
  const searchable = members.length > 6;
  const needle = q.trim().toLowerCase();
  const sorted = [...members]
    .sort((a, b) => Number(!!b.isSelf) - Number(!!a.isSelf) || (a.name || a.email || "").localeCompare(b.name || b.email || ""))
    .filter((m) => !needle || `${m.name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(needle));

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      draggable={false}
      onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
      style={{ position: "fixed", left, width: WIDTH, maxHeight: maxH, ...(flip ? { bottom: window.innerHeight - anchor.top + 6 } : { top: below }) }}
      className="z-50 flex flex-col rounded-lg border border-slate-200 bg-white shadow-lg"
    >
      <div className="shrink-0 border-b border-slate-100 p-1.5">
        <div className="px-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Who&apos;s working this lead?</div>
        {searchable && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && sorted.length === 1) onPick(sorted[0].userId); }}
              placeholder="Find a teammate…"
              className="h-7 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-sm focus:border-brand-red/50 focus:outline-none"
            />
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
      {sorted.length === 0 && <div className="px-2 py-3 text-center text-xs text-muted-foreground">No one matches &ldquo;{q}&rdquo;</div>}
      {sorted.map((m) => (
        <button
          key={m.userId}
          type="button"
          onClick={() => onPick(m.userId)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-100"
        >
          <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white", colorFor(m.userId))}>
            {initialsOf(m)}
          </span>
          <span className="min-w-0 flex-1 truncate">
            {m.name || m.email}
            {m.isSelf && <span className="ml-1 text-xs text-muted-foreground">(me)</span>}
          </span>
          {m.userId === workingUserId && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
        </button>
      ))}
      <div className="my-1 border-t border-slate-100" />
      <button
        type="button"
        onClick={() => onPick(null)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-slate-100"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-slate-300">
          <UserRound className="h-3.5 w-3.5" />
        </span>
        <span className="flex-1">Nobody</span>
        {!workingUserId && <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
      </button>
      </div>
    </div>
  );
}
