"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Eye, Megaphone, CheckCircle2, TrendingDown, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface FunnelData {
  views: number;
  completes: number;
  completionRate: number;
  adViews?: number;
  adCompletes?: number;
  adCompletionRate?: number;
}

const RANGES: [string, string][] = [["today", "Today"], ["7d", "7 days"], ["30d", "30 days"]];

/**
 * Always-visible live traffic strip for the top of the admin console.
 * Surfaces real landing-page visits (first-party FunnelEvent data) without
 * making the operator dig into the Funnel analytics tab. Auto-refreshes so the
 * "Live" state is real. `onOpenFunnel` deep-links to the full step-by-step tab.
 */
export function TrafficSnapshot({ onOpenFunnel }: { onOpenFunnel?: () => void }) {
  const [range, setRange] = useState("today");
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const firstLoad = useRef(true);

  const load = useCallback(() => {
    if (firstLoad.current) setLoading(true);
    fetch(`/api/admin/funnel?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        setData(d);
        setUpdatedAt(new Date());
      })
      .catch(() => setData((prev) => prev))
      .finally(() => {
        setLoading(false);
        firstLoad.current = false;
      });
  }, [range]);

  useEffect(() => {
    firstLoad.current = true;
    load();
    // Refresh every 60s so the strip stays live while the console is open.
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const views = data?.views ?? 0;
  const adViews = data?.adViews ?? 0;
  const completes = data?.completes ?? 0;
  const rate = data?.completionRate ?? 0;

  return (
    <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <h3 className="text-sm font-semibold">Site traffic</h3>
          <span className="text-xs text-muted-foreground">
            americanbluecollaradvantage.com
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {RANGES.map(([val, label]) => (
              <button
                key={val}
                onClick={() => setRange(val)}
                className={cn(
                  "px-2.5 py-1 text-xs transition-colors",
                  range === val ? "bg-brand-red text-white" : "bg-white text-muted-foreground hover:bg-slate-50",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {onOpenFunnel && (
            <button
              onClick={onOpenFunnel}
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-red hover:underline"
            >
              Full funnel <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 justify-center py-6 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading traffic…
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Page visits"
            value={views.toLocaleString()}
          />
          <div className="rounded-lg border border-brand-red/30 bg-brand-red/[0.03] p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Megaphone className="h-3.5 w-3.5 text-brand-red" /> From ads (FB)
            </div>
            <div className="text-2xl font-semibold leading-tight">{adViews.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">
              {data?.adCompletes ?? 0} completed · {data?.adCompletionRate ?? 0}%
            </div>
          </div>
          <Stat
            icon={<CheckCircle2 className="h-3.5 w-3.5" />}
            label="Completed"
            value={completes.toLocaleString()}
            valueClass="text-emerald-600"
          />
          <Stat
            icon={<TrendingDown className="h-3.5 w-3.5" />}
            label="Completion rate"
            value={`${rate}%`}
          />
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Live first-party visits (anonymous). <span className="font-medium text-foreground">From ads</span> = arrived with a
        Facebook click ID.
        {updatedAt && (
          <> · Updated {updatedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</>
        )}
      </p>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className={cn("text-2xl font-semibold leading-tight", valueClass)}>{value}</div>
    </div>
  );
}
