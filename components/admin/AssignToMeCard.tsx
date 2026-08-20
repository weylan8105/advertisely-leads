"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserPlus, UserMinus, Loader2, Check, Inbox, Briefcase, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tiersForGroup } from "@/data/packages";
import { cn } from "@/lib/utils";

const ACTIVE_STATES = ["TX", "FL", "CA", "IL", "PA", "OH", "CO", "MI", "WA"];
const AGE_TIERS = tiersForGroup("iul"); // freshest → oldest, each with age window

export function AssignToMeCard() {
  const [quantity, setQuantity] = useState(50);
  const [tierId, setTierId] = useState("any");
  const [states, setStates] = useState<string[]>([]);
  const [busy, setBusy] = useState<"assign" | "return" | "return-all" | null>(null);
  const [poolCount, setPoolCount] = useState<number | null>(null);
  const [myCount, setMyCount] = useState<number | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function loadCounts() {
    try {
      const [pool, mine] = await Promise.all([
        fetch("/api/admin/leads?assigned=unassigned&limit=1").then((r) => r.json()),
        fetch("/api/leads").then((r) => r.json()),
      ]);
      setPoolCount(pool?.counts?.unassigned ?? pool?.counts?.total ?? null);
      setMyCount(Array.isArray(mine?.leads) ? mine.leads.length : null);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    loadCounts();
  }, []);

  const toggleState = (s: string) =>
    setStates((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  function tierWindow() {
    const tier = AGE_TIERS.find((t) => t.id === tierId);
    const body: any = {};
    if (tier) {
      body.ageMinDays = tier.ageMinDays;
      if (tier.ageMaxDays != null) body.ageMaxDays = tier.ageMaxDays;
    }
    return body;
  }

  async function assign() {
    setBusy("assign");
    setResult(null);
    const res = await fetch("/api/admin/assign-to-me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity, states, ...tierWindow() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setResult({
        ok: true,
        text:
          data.assigned > 0
            ? `Assigned ${data.assigned} lead${data.assigned === 1 ? "" : "s"} to your CRM — free.`
            : "No matching unassigned leads in the pool right now.",
      });
      loadCounts();
    } else {
      setResult({ ok: false, text: data.error ?? "Could not assign leads" });
    }
  }

  async function returnToPool(all: boolean) {
    if (all && !confirm("Return ALL your self-assigned leads to the pool for other clients to buy?")) return;
    setBusy(all ? "return-all" : "return");
    setResult(null);
    const res = await fetch("/api/admin/unassign-from-me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(all ? { all: true } : { quantity, states, ...tierWindow() }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (res.ok) {
      setResult({
        ok: true,
        text:
          data.unassigned > 0
            ? `Returned ${data.unassigned} lead${data.unassigned === 1 ? "" : "s"} to the pool — now purchasable.`
            : "No returnable leads matched that.",
      });
      loadCounts();
    } else {
      setResult({ ok: false, text: data.error ?? "Could not return leads" });
    }
  }

  return (
    <Card className="p-6 mt-8 border-brand-red/30 ring-1 ring-brand-red/10">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold tracking-tight flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-brand-red" /> My CRM — assign &amp; return leads
          </h2>
          <p className="mt-1 text-sm text-muted-foreground max-w-lg">
            Pull unassigned leads into your own CRM at <span className="font-medium text-foreground">zero cost</span>,
            or return them to the house pool for other clients to purchase.
          </p>
        </div>
        <div className="flex gap-6">
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Unassigned pool</div>
            <div className="text-2xl font-semibold flex items-center gap-1 justify-end">
              <Inbox className="h-4 w-4 text-muted-foreground" />
              {poolCount ?? "—"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">My CRM</div>
            <div className="text-2xl font-semibold flex items-center gap-1 justify-end">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              {myCount ?? "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Filters (shared by assign + return) */}
      <div className="mt-5 grid sm:grid-cols-[120px_1fr] gap-4 items-end">
        <div className="space-y-1.5">
          <Label>Quantity</Label>
          <Input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Lead age</Label>
          <select
            value={tierId}
            onChange={(e) => setTierId(e.target.value)}
            className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="any">Any age</option>
            {AGE_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name.replace(/^Fresh IUL — /, "").replace(/^IUL — /, "")}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <Label>
          States <span className="text-muted-foreground font-normal">(none = any state)</span>
        </Label>
        <div className="flex flex-wrap gap-2">
          {ACTIVE_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => toggleState(s)}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm transition-colors",
                states.includes(s)
                  ? "border-red-500 bg-red-50 text-red-700 font-medium"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 flex-wrap">
        <Button onClick={assign} disabled={busy !== null}>
          {busy === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
          Assign {quantity} to my CRM (free)
        </Button>
        <Button variant="outline" onClick={() => returnToPool(false)} disabled={busy !== null}>
          {busy === "return" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
          Return {quantity} to pool
        </Button>
        <Button variant="ghost" size="sm" onClick={() => returnToPool(true)} disabled={busy !== null}>
          {busy === "return-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Return all my leads
        </Button>
        {myCount != null && myCount > 0 && (
          <Link href="/leads" className="text-sm text-brand-red hover:underline inline-flex items-center gap-1 ml-auto">
            Open my CRM <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      {result && (
        <p className={cn("mt-3 text-sm flex items-center gap-1.5", result.ok ? "text-emerald-600" : "text-rose-600")}>
          {result.ok && <Check className="h-4 w-4" />}
          {result.text}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">
        Returning leads only affects your free self-assigned leads — never leads tied to a paid order. Age &amp;
        state filters above apply to both actions.
      </p>
    </Card>
  );
}
