"use client";

import { useEffect, useRef } from "react";
import { Check, UserRound } from "lucide-react";
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
 * column's scroll container can't clip it. Closes on outside click, Esc or scroll.
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
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  const WIDTH = 224;
  const left = Math.max(8, Math.min(anchor.right - WIDTH, window.innerWidth - WIDTH - 8));
  const below = anchor.bottom + 6;
  const maxH = 300;
  const flip = below + maxH > window.innerHeight && anchor.top > maxH;
  const sorted = [...members].sort((a, b) => Number(!!b.isSelf) - Number(!!a.isSelf));

  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      style={{ position: "fixed", left, width: WIDTH, maxHeight: maxH, ...(flip ? { bottom: window.innerHeight - anchor.top + 6 } : { top: below }) }}
      className="z-50 overflow-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
    >
      <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Who&apos;s working this lead?</div>
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
  );
}
