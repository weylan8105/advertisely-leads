"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Gem, Loader2, Shuffle, User } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Destination = "PERSONAL" | "SPLIT" | "GOLDMINE";

interface Data {
  show: boolean;
  destination: Destination;
  teamName: string | null;
  members: number;
  goldmineMembers: number;
}

const OPTIONS: { id: Destination; label: string; icon: typeof User; blurb: string }[] = [
  { id: "PERSONAL", label: "My pipeline only", icon: User, blurb: "Every new lead goes to your own pipeline." },
  {
    id: "SPLIT",
    label: "Round robin with Goldmine",
    icon: Shuffle,
    blurb: "New leads take turns: one to your pipeline, the next to your team's Goldmine.",
  },
  { id: "GOLDMINE", label: "Goldmine only", icon: Gem, blurb: "Every new lead goes to your team's Goldmine for them to work." },
];

/**
 * Dashboard: where the owner's incoming leads land (lib/leadDestination.ts).
 * Shown to advertisers and anyone with at least one team member.
 */
export function LeadDestinationCard({ className }: { className?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [saving, setSaving] = useState<Destination | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/team/lead-destination", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d))
      .catch(() => {});
  }, []);

  async function choose(destination: Destination) {
    if (!data || destination === data.destination) return;
    setSaving(destination);
    setError(null);
    try {
      const r = await fetch("/api/team/lead-destination", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destination }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't save");
      setData({ ...data, destination });
    } catch (e: any) {
      setError(e.message ?? "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  if (!data?.show) return null;
  const noGoldmineTeam = data.goldmineMembers === 0;

  return (
    <Card id="lead-destination" className={cn("p-5 scroll-mt-20", className)}>
      <div className="flex items-center gap-2">
        <Shuffle className="h-4 w-4 text-brand-red" />
        <h3 className="text-sm font-semibold">Where your new leads go</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Your campaign leads and the leads you order for yourself. Goldmine leads stay yours, and everyone on{" "}
        {data.teamName ?? "your team"} with Goldmine access can work them.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const on = data.destination === o.id;
          const locked = o.id !== "PERSONAL" && noGoldmineTeam;
          const Icon = o.icon;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(o.id)}
              disabled={!!saving || locked}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                on ? "border-brand-red bg-brand-red/5 ring-1 ring-brand-red" : "border-slate-200 hover:border-slate-300",
                locked && "cursor-not-allowed opacity-50 hover:border-slate-200",
              )}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                {saving === o.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                {o.label}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{o.blurb}</p>
            </button>
          );
        })}
      </div>
      {noGoldmineTeam && (
        <p className="mt-3 text-xs text-muted-foreground">
          To use the Goldmine options,{" "}
          <Link href="/team" className="font-medium text-brand-red hover:underline">
            add a team member
          </Link>{" "}
          with Goldmine access.
        </p>
      )}
      {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}
    </Card>
  );
}
