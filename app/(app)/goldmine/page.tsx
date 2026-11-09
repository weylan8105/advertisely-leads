"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Gem, Loader2, SlidersHorizontal, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { PipelineBoard } from "@/components/leads/PipelineBoard";
import { PipelineEditor } from "@/components/leads/PipelineEditor";
import { PIPELINE_STAGES, DEFAULT_PIPELINE_SORT, parsePipelineSort, type PipelineStage, type PipelineSort } from "@/data/pipeline";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { changedLeadIds, mergeLeadDelta } from "@/lib/pipelineSync";
import type { Lead } from "@/types";

// Several people call from Goldmine at once, so the board picks up their moves,
// notes and dials this often while the tab is open.
const REFRESH_MS = 10_000;
// A card you just changed keeps your copy this long, so a refresh can't undo a
// move that is still saving.
const LOCAL_GRACE_MS = 15_000;

interface LeadsResponse {
  leads?: Lead[];
  ids?: string[];
  asOf?: string;
}

interface GoldmineConfig {
  enabled: boolean;
  afterDays: number | null;
  stages: PipelineStage[];
  canManage: boolean;
  organizationName?: string;
}

export default function GoldminePage() {
  const [config, setConfig] = useState<GoldmineConfig | null>(null);
  const [leads, setLeadsState] = useState<Lead[]>([]);
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

  // The board's own edits go through here, which notes which cards the viewer touched.
  const touchedAt = useRef(new Map<string, number>());
  const setLeads = useCallback<React.Dispatch<React.SetStateAction<Lead[]>>>((update) => {
    setLeadsState((cur) => {
      const next = typeof update === "function" ? update(cur) : update;
      const at = Date.now();
      for (const id of changedLeadIds(cur, next)) touchedAt.current.set(id, at);
      return next;
    });
  }, []);

  // asOf from the last response; the next refresh asks only for what changed since.
  const asOf = useRef<string | null>(null);
  const needFull = useRef(false);
  const applyLeads = useCallback((d: LeadsResponse) => {
    const changed = d.leads ?? [];
    const ids = d.ids ?? changed.map((l) => l.id);
    const now = Date.now();
    touchedAt.current.forEach((at, id) => {
      if (now - at >= LOCAL_GRACE_MS) touchedAt.current.delete(id);
    });
    setLeadsState((cur) => {
      const m = mergeLeadDelta(cur, changed, ids, touchedAt.current, now, LOCAL_GRACE_MS);
      if (m.missing) needFull.current = true;
      return m.leads;
    });
    if (d.asOf) asOf.current = d.asOf;
  }, []);

  async function loadLeads(since: string | null) {
    const r = await fetch(`/api/leads?pipeline=goldmine${since ? `&since=${encodeURIComponent(since)}` : ""}`, {
      cache: "no-store",
    });
    return r.ok ? ((await r.json()) as LeadsResponse) : null;
  }

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
        const d = await loadLeads(null);
        if (active && d) applyLeads(d);
      }
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live refresh while the tab is visible (and right away when you come back to it).
  const enabled = !!config?.enabled;
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState !== "visible") return;
      busy = true;
      try {
        const full = needFull.current || !asOf.current;
        const d = await loadLeads(full ? null : asOf.current);
        if (live && d) {
          if (full) needFull.current = false;
          applyLeads(d);
        }
      } catch {
        // Offline or a blip; the next tick tries again.
      } finally {
        busy = false;
      }
    };
    const t = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, applyLeads]);

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
        const d = await loadLeads(null);
        if (d) applyLeads(d);
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
              {" "}Updates every {REFRESH_MS / 1000} seconds.
            </p>
          </div>
          <PipelineBoard
            leads={leads}
            setLeads={setLeads}
            stages={stages}
            sortMode={sortMode}
            presenceMs={REFRESH_MS}
          />
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
