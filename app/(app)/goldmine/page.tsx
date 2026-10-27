"use client";

import { useEffect, useState } from "react";
import { Gem, Loader2, SlidersHorizontal, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PipelineBoard } from "@/components/leads/PipelineBoard";
import { PipelineEditor } from "@/components/leads/PipelineEditor";
import { PIPELINE_STAGES, DEFAULT_PIPELINE_SORT, parsePipelineSort, type PipelineStage, type PipelineSort } from "@/data/pipeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Lead } from "@/types";

interface GoldmineConfig {
  enabled: boolean;
  afterDays: number | null;
  stages: PipelineStage[];
  canManage: boolean;
  organizationName?: string;
}

export default function GoldminePage() {
  const [config, setConfig] = useState<GoldmineConfig | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [enabling, setEnabling] = useState(false);
  // The viewer's own card-order preference (set in Customize stages on their pipeline).
  const [sortMode, setSortMode] = useState<PipelineSort>(DEFAULT_PIPELINE_SORT);

  useEffect(() => {
    fetch("/api/pipeline/stages")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.sort && setSortMode(parsePipelineSort(d.sort)))
      .catch(() => {});
  }, []);

  async function loadConfig() {
    const r = await fetch("/api/goldmine");
    return r.ok ? ((await r.json()) as GoldmineConfig) : null;
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const cfg = await loadConfig();
      if (!active) return;
      setConfig(cfg);
      if (cfg?.enabled) {
        const r = await fetch("/api/leads?pipeline=goldmine");
        const d = r.ok ? await r.json() : { leads: [] };
        if (active) setLeads(d.leads ?? []);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  async function enableGoldmine() {
    setEnabling(true);
    try {
      const r = await fetch("/api/goldmine", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      });
      if (r.ok) {
        const cfg = await loadConfig();
        setConfig(cfg);
        const lr = await fetch("/api/leads?pipeline=goldmine");
        const d = lr.ok ? await lr.json() : { leads: [] };
        setLeads(d.leads ?? []);
      }
    } finally {
      setEnabling(false);
    }
  }

  const stages = config?.stages ?? PIPELINE_STAGES;

  return (
    <div>
      <PageHeader
        title="Goldmine"
        description="Your team's shared pool of aged leads. Everyone can work and close these — conversions still count."
        actions={
          config?.enabled && config.canManage ? (
            <Button variant="outline" size="sm" onClick={() => setShowEditor(true)}>
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Customize stages
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <Card className="p-12 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading Goldmine…</span>
        </Card>
      ) : !config?.enabled ? (
        <Card className="p-8 text-center max-w-xl mx-auto">
          <Gem className="h-10 w-10 text-brand-red mx-auto mb-3" />
          <h3 className="text-lg font-semibold">Goldmine isn&apos;t turned on yet</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Goldmine gives your downline a shared pool of your aged leads to re-work and close. Your
            older leads move here automatically after a number of days you choose.
          </p>
          {config?.canManage ? (
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button onClick={enableGoldmine} disabled={enabling}>
                {enabling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Gem className="h-4 w-4" />}
                Turn on Goldmine
              </Button>
              <a href="/settings?tab=goldmine">
                <Button variant="outline">Configure in Settings</Button>
              </a>
            </div>
          ) : (
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="h-3.5 w-3.5" /> Your team owner needs to turn this on.
            </p>
          )}
        </Card>
      ) : (
        <Card className="p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold">Team Goldmine</h3>
            <p className="text-xs text-muted-foreground">
              Shared aged-lead pool — anyone on the team can move, text, and close these.
              {config.afterDays ? ` Leads move here ${config.afterDays} days after they're assigned.` : ""}
            </p>
          </div>
          <PipelineBoard leads={leads} setLeads={setLeads} stages={stages} sortMode={sortMode} />
        </Card>
      )}

      {showEditor && config?.enabled && (
        <PipelineEditor
          stages={stages}
          endpoint="/api/goldmine"
          onClose={() => setShowEditor(false)}
          onSaved={(next) => setConfig((c) => (c ? { ...c, stages: next } : c))}
        />
      )}
    </div>
  );
}
