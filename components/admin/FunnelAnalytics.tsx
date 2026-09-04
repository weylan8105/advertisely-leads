"use client";

import { useEffect, useState, useCallback } from "react";
import { Loader2, TrendingDown, Eye, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Step { step: number; label: string; count: number; stepConversion: number; }
interface FunnelData {
  range: string; views: number; completes: number; completionRate: number; steps: Step[];
}

const RANGES: [string, string][] = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];

export function FunnelAnalytics() {
  const [range, setRange] = useState("7d");
  const [data, setData] = useState<FunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/funnel?range=${range}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [range]);

  useEffect(() => { load(); }, [load]);

  const top = data?.steps[0]?.count || data?.views || 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
          {RANGES.map(([val, label]) => (
            <button
              key={val}
              onClick={() => setRange(val)}
              className={cn(
                "px-3 py-1.5 text-sm transition-colors",
                range === val ? "bg-brand-red text-white" : "bg-white text-muted-foreground hover:bg-slate-50",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 justify-center py-16 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading funnel…
        </div>
      ) : !data ? (
        <div className="text-rose-600 text-sm py-8 text-center">Couldn&apos;t load funnel analytics.</div>
      ) : data.views === 0 ? (
        <div className="text-sm text-muted-foreground py-10 text-center">
          No visits recorded in this range yet. Data starts collecting as people land on the funnel.
        </div>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Page views</div>
              <div className="text-2xl font-semibold">{data.views.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Completed</div>
              <div className="text-2xl font-semibold text-emerald-600">{data.completes.toLocaleString()}</div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingDown className="h-3.5 w-3.5" /> Completion rate</div>
              <div className="text-2xl font-semibold">{data.completionRate}%</div>
            </div>
          </div>

          {/* Step funnel */}
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">How far visitors get</div>
          <div className="space-y-2">
            {data.steps.map((s, i) => {
              const pctOfTop = top > 0 ? Math.round((s.count / top) * 100) : 0;
              const dropFromPrev = i > 0 ? 100 - s.stepConversion : 0;
              return (
                <div key={s.step} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-sm text-right text-muted-foreground">
                    {s.step}. {s.label}
                  </div>
                  <div className="flex-1 h-8 rounded-md bg-slate-100 overflow-hidden relative">
                    <div
                      className="h-full bg-gradient-to-r from-brand-red to-amber-400 flex items-center px-2"
                      style={{ width: `${Math.max(pctOfTop, 3)}%` }}
                    >
                      <span className="text-xs font-semibold text-white drop-shadow">{s.count.toLocaleString()}</span>
                    </div>
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
                      {pctOfTop}% of visitors
                    </span>
                  </div>
                  <div className="w-24 shrink-0 text-xs text-right">
                    {i > 0 && (
                      <span className={cn(dropFromPrev >= 40 ? "text-rose-600" : "text-muted-foreground")}>
                        {dropFromPrev > 0 ? `−${dropFromPrev}% drop` : "held"}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {/* Completion row */}
            <div className="flex items-center gap-3 pt-1">
              <div className="w-28 shrink-0 text-sm text-right font-medium text-emerald-700">✓ Completed</div>
              <div className="flex-1 h-8 rounded-md bg-slate-100 overflow-hidden relative">
                <div
                  className="h-full bg-emerald-500 flex items-center px-2"
                  style={{ width: `${Math.max(top > 0 ? Math.round((data.completes / top) * 100) : 0, 3)}%` }}
                >
                  <span className="text-xs font-semibold text-white drop-shadow">{data.completes.toLocaleString()}</span>
                </div>
              </div>
              <div className="w-24 shrink-0 text-xs text-right text-emerald-700 font-medium">{data.completionRate}%</div>
            </div>
          </div>

          <p className="mt-4 text-[11px] text-muted-foreground">
            &quot;Page views&quot; = landing-page loads · each bar = visitors who reached that step · the drop % shows where
            people leave. Click-through = completion rate ({data.completionRate}%). Data is first-party and anonymous.
          </p>
        </>
      )}
    </div>
  );
}
