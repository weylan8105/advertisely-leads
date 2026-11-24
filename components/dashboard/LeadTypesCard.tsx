"use client";

import { useEffect, useState } from "react";
import { Loader2, Layers } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LeadTypeOption } from "@/lib/leadTypes";

/**
 * Advertiser dashboard: switch lead types on or off (User.leadTypes). You only
 * get shared leads of the types you have on.
 */
export function LeadTypesCard() {
  const [types, setTypes] = useState<LeadTypeOption[] | null>(null);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/advertiser/lead-types", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.types) {
          setTypes(d.types);
          setEnabled(d.enabled ?? []);
        }
      })
      .catch(() => {});
  }, []);

  // Switched on from the announcement pop-up: show it here without a reload.
  useEffect(() => {
    const onChange = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (Array.isArray(d?.enabled)) setEnabled(d.enabled);
    };
    window.addEventListener("advertisely:lead-types", onChange);
    return () => window.removeEventListener("advertisely:lead-types", onChange);
  }, []);

  async function toggle(id: string) {
    const next = enabled.includes(id) ? enabled.filter((x) => x !== id) : [...enabled, id];
    setSaving(id);
    setError(null);
    try {
      const r = await fetch("/api/advertiser/lead-types", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadTypes: next }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Couldn't save");
      setEnabled(d.enabled ?? next);
    } catch (e: any) {
      setError(e.message ?? "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  // Arriving from the announcement (/dashboard#lead-types): bring the card into view once it's there.
  useEffect(() => {
    if (!types?.length) return;
    const go = () => {
      if (window.location.hash === "#lead-types") document.getElementById("lead-types")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, [types]);

  if (!types?.length) return null;

  return (
    <Card id="lead-types" className="mb-6 scroll-mt-20 p-5">
      <div className="flex items-center gap-2">
        <Layers className="h-4 w-4 text-brand-red" />
        <h3 className="text-sm font-semibold">Lead types</h3>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose the kinds of leads you want. You only get the types you have on, in your licensed states, paid from your ad
        spend.
      </p>
      <ul className="mt-4 divide-y divide-slate-100">
        {types.map((t) => {
          const on = enabled.includes(t.id);
          return (
            <li key={t.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium">
                  {t.label}
                  {t.isNew && (
                    <span className="rounded-full bg-brand-red/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-red">
                      New
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
              </div>
              <div className="flex items-center gap-2">
                {saving === t.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                <Switch on={on} disabled={saving !== null} onClick={() => toggle(t.id)} label={t.label} />
              </div>
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
    </Card>
  );
}

function Switch({ on, disabled, onClick, label }: { on: boolean; disabled?: boolean; onClick?: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed",
        on ? "bg-brand-red" : "bg-slate-300",
        disabled ? "opacity-60" : "",
      )}
    >
      <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}
