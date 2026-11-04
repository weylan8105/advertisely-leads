"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gauge, Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Vol {
  /** null = keep every lead; 0 = the team gets all of them. */
  keep: number | null;
  kept7d: number;
  /** When at/over the amount: when enough leads age out of the rolling week to keep again. */
  resumesAt: string | null;
  teammates: number;
  distributionMode: "MANUAL" | "ROUND_ROBIN" | "WEEKLY_QUOTA";
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * Advertisers only (renders nothing for anyone else): how many of their own
 * campaign leads they keep per rolling 7 days — the rest go to their team.
 * The advertiser-side twin of AdminLeadVolumeCard.
 */
export function AdvertiserLeadVolumeCard() {
  const [data, setData] = useState<Vol | null>(null);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/advertiser/lead-volume")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Vol | null) => {
        setData(d);
        setInput(d?.keep === null || d?.keep === undefined ? "" : String(d.keep));
      })
      .catch(() => setData(null));
  }, []);

  async function save(value: string) {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch("/api/advertiser/lead-volume", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keep: value.trim() === "" ? null : Number(value) }),
      });
      const d = await r.json().catch(() => null);
      if (r.ok && d) {
        setData(d);
        setInput(d.keep === null ? "" : String(d.keep));
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!data) return null;
  const { keep, kept7d, teammates } = data;
  const keepingAll = keep === null;
  const teamGetsAll = keep === 0;
  const atLimit = !keepingAll && !teamGetsAll && kept7d >= keep!;

  return (
    <Card className="p-4 mb-4">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
        <Gauge className="h-3.5 w-3.5" /> Your campaign leads
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        How many of your own campaign leads you keep each rolling 7 days. Once you&apos;ve kept that many, new leads go to
        your team{data.distributionMode === "WEEKLY_QUOTA" ? " by their weekly amounts" : ", spread evenly"} so they can eat.
        Set 0 to give your team every lead. Blank = keep them all.
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Keep all"
            className="w-28 h-9 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-red focus:outline-none"
          />
          <span className="text-sm text-muted-foreground">leads / 7 days</span>
          <Button size="sm" onClick={() => save(input)} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
            {saved ? "Saved" : "Save"}
          </Button>
          {!teamGetsAll && (
            <Button size="sm" variant="outline" onClick={() => { setInput("0"); void save("0"); }} disabled={saving}>
              Give all to my team
            </Button>
          )}
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="tabular-nums font-semibold">
            {kept7d}
            <span className="text-muted-foreground font-normal"> / {keepingAll ? "all" : keep}</span>
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
              keepingAll ? "border-slate-200 bg-slate-50 text-slate-600"
                : teamGetsAll || atLimit ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700",
            )}
          >
            {keepingAll ? "Keeping every lead" : teamGetsAll ? "Team gets every lead" : atLimit ? "Full — team is getting leads" : "Keeping leads"}
          </span>
        </div>
      </div>

      {atLimit && data.resumesAt && (
        <p className="mt-2 text-xs text-sky-700">
          You&apos;ll start keeping leads again {when(data.resumesAt)}, when enough of this week&apos;s leads age out of the rolling 7 days.
        </p>
      )}
      {!keepingAll && teammates === 0 && (
        <p className="mt-2 text-xs text-amber-700">
          You don&apos;t have anyone on your team yet, so you&apos;ll keep every lead until you{" "}
          <Link href="/team" className="underline">add a team member</Link>.
        </p>
      )}
    </Card>
  );
}
