"use client";

import { useEffect, useRef, useState } from "react";
import { Trophy, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Deal {
  id: string;
  at: string;
  agent: string;
  image: string | null;
  apCents: number;
  stage: string;
  isMe: boolean;
}

const POLL_MS = 15_000;
const SHOW_MS = 9_000;
const MAX_SHOWN = 3;

const usd0 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/**
 * Live deal alerts: whenever anyone submits a deal (moves a lead to
 * Underwriting or later with its AP), every signed-in user gets a pop-up in the
 * bottom-left corner within ~15 seconds. Lower-right is taken by page toasts
 * and the admin user-mode switch.
 */
export function DealAlerts() {
  const [shown, setShown] = useState<Deal[]>([]);
  const since = useRef<string | null>(null);
  const seen = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      if (document.visibilityState === "visible") {
        try {
          const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
          const res = await fetch(`/api/deals/live${q}`, { cache: "no-store" });
          if (res.ok) {
            const data = (await res.json()) as { now: string; deals: Deal[] };
            since.current = data.now;
            const fresh = (data.deals ?? []).filter((d) => !seen.current.has(d.id));
            fresh.forEach((d) => seen.current.add(d.id));
            if (alive && fresh.length) {
              setShown((cur) => [...cur, ...fresh].slice(-MAX_SHOWN));
              fresh.forEach((d) =>
                setTimeout(() => alive && setShown((cur) => cur.filter((x) => x.id !== d.id)), SHOW_MS),
              );
            }
          }
        } catch {
          /* offline — try again next tick */
        }
      }
      if (alive) timer = setTimeout(poll, POLL_MS);
    }

    poll();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!shown.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-20 left-4 z-40 flex w-[min(20rem,calc(100vw-2rem))] flex-col gap-2 lg:bottom-4 lg:left-[17rem]"
      aria-live="polite"
    >
      {shown.map((d) => (
        <div
          key={d.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-xl border bg-white p-3 pr-2 shadow-lg animate-in slide-in-from-bottom-4 fade-in duration-300",
            d.isMe ? "border-emerald-300" : "border-amber-300",
          )}
        >
          <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-full", d.isMe ? "bg-emerald-50" : "bg-amber-50")}>
            <Trophy className={cn("h-5 w-5", d.isMe ? "text-emerald-600" : "text-amber-500")} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground">
              {d.isMe ? "You" : d.agent} just submitted a deal!
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
              {d.apCents > 0 ? `${usd0(d.apCents)} AP` : "New deal"}
            </div>
            <div className="text-xs text-muted-foreground">{d.stage} · keep dialing 📞</div>
          </div>
          <button
            type="button"
            onClick={() => setShown((cur) => cur.filter((x) => x.id !== d.id))}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-slate-100 hover:text-foreground"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
