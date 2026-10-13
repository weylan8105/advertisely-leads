"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Gem, Loader2, Check, SlidersHorizontal, Lock } from "lucide-react";
import { PipelineEditor } from "@/components/leads/PipelineEditor";
import { PIPELINE_STAGES, type PipelineStage } from "@/data/pipeline";
import { cn } from "@/lib/utils";

interface Config {
  enabled: boolean;
  afterDays: number | null;
  stages: PipelineStage[];
  canManage: boolean;
  organizationName?: string;
}

export function GoldmineSettingsCard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const load = () => {
    setLoading(true);
    fetch("/api/goldmine")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Config | null) => {
        setConfig(d);
        setDays(d?.afterDays ? String(d.afterDays) : "");
      })
      .catch(() => setConfig(null))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  async function patch(body: Record<string, unknown>, msg: string) {
    setSaving(true);
    setBanner(null);
    try {
      const r = await fetch("/api/goldmine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "Could not save");
      setConfig((c) => (c ? { ...c, ...d } : d));
      setBanner(msg);
    } catch (e: any) {
      setBanner(e.message ?? "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gem className="h-4 w-4 text-brand-red" />
          Goldmine
        </CardTitle>
        <CardDescription>
          Share your aged leads with your downline in a second, team-wide pipeline. Older leads move
          here automatically so your team can re-work and close them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {banner && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" /> {banner}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : !config?.canManage ? (
          <p className="text-sm text-muted-foreground inline-flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Only your team owner or admin can configure Goldmine.
          </p>
        ) : (
          <>
            {/* Enable toggle */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Goldmine pipeline</div>
                <div className="text-xs text-muted-foreground">
                  {config.enabled ? "On — your team can work the Goldmine board." : "Off"}
                </div>
              </div>
              <Button
                variant={config.enabled ? "outline" : "default"}
                size="sm"
                disabled={saving}
                onClick={() => patch({ enabled: !config.enabled }, config.enabled ? "Goldmine turned off." : "Goldmine turned on.")}
              >
                {config.enabled ? "Turn off" : "Turn on"}
              </Button>
            </div>

            {config.enabled && (
              <>
                {/* Auto-move days */}
                <div className="border-t border-slate-100 pt-4">
                  <label className="text-sm font-medium">Move leads to Goldmine after…</label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Days since a lead was assigned to you. Sold leads never move. Leave blank to move none
                    automatically (you can still move leads by hand).
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      placeholder="e.g. 30"
                      className="w-28 h-10 rounded-md border border-slate-200 px-3 text-sm focus:border-brand-red focus:outline-none"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        const n = parseInt(days, 10);
                        patch(
                          { afterDays: days.trim() === "" ? null : Number.isFinite(n) ? n : null },
                          "Auto-move timing saved.",
                        );
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>

                {/* Stages */}
                <div className="border-t border-slate-100 pt-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">Goldmine stages</div>
                    <div className="text-xs text-muted-foreground">
                      Customize the Goldmine board&apos;s columns (conversion stages stay locked).
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowEditor(true)}>
                    <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </CardContent>

      {showEditor && config && (
        <PipelineEditor
          stages={config.stages}
          endpoint="/api/goldmine"
          title="Customize Goldmine stages"
          onClose={() => setShowEditor(false)}
          onSaved={(next) => setConfig((c) => (c ? { ...c, stages: next } : c))}
        />
      )}
    </Card>
  );
}
