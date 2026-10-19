"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gauge, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Vol {
  target: number | null;
  received7d: number;
}

export function AdminLeadVolumeCard() {
  const [data, setData] = useState<Vol | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = () =>
    fetch("/api/admin/lead-volume")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Vol | null) => {
        setData(d);
        setInput(d?.target ? String(d.target) : "");
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const n = parseInt(input, 10);
      const r = await fetch("/api/admin/lead-volume", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: input.trim() === "" || isNaN(n) ? null : n }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setData(d);
        setInput(d.target ? String(d.target) : "");
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } finally {
      setSaving(false);
    }
  }

  const target = data?.target ?? null;
  const got = data?.received7d ?? 0;
  const inRotation = !!target && got < target;
  const atLimit = !!target && got >= target;

  return (
    <Card className="p-4 mb-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Gauge className="h-3.5 w-3.5" /> Your weekly lead volume
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            How many overflow leads you want each rolling 7-day period. While you&apos;re under it you&apos;re in the
            round-robin; once you hit it you drop out until your rolling week frees up. Blank = none.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. 100"
                className="w-28 h-9 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-red focus:outline-none"
              />
              <span className="text-sm text-muted-foreground">leads / 7 days</span>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
                {saved ? "Saved" : "Save"}
              </Button>
            </div>

            <div className="flex items-center gap-3 text-sm">
              <span className="tabular-nums font-semibold">
                {got}
                <span className="text-muted-foreground font-normal"> / {target ?? "—"}</span>
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  inRotation ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : atLimit ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-slate-50 text-slate-600",
                )}
              >
                {inRotation ? "In the rotation" : atLimit ? "At your limit — paused" : "Not taking overflow"}
              </span>
            </div>
          </div>

          {!!target && (
            <div className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn("h-full rounded-full transition-all", atLimit ? "bg-amber-400" : "bg-gradient-to-r from-brand-red to-brand-redDark")}
                style={{ width: `${Math.min(100, Math.round((got / target) * 100))}%` }}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
