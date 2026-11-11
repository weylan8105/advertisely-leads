"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { changedLeadIds, mergeLeadDelta } from "@/lib/pipelineSync";
import type { Lead } from "@/types";

/** How often a CRM board checks for new and changed leads (Goldmine keeps its own 10s). */
export const CRM_REFRESH_MS = 15_000;
// A card you just changed keeps your copy this long, so a refresh can't undo a
// move that is still saving.
const LOCAL_GRACE_MS = 15_000;

interface LeadsResponse {
  leads?: Lead[];
  ids?: string[];
  asOf?: string;
}

/**
 * A CRM board's leads, kept live: loads `url` (an /api/leads URL), then every
 * `intervalMs` while the tab is visible asks only for what changed since the last
 * load, so new leads drip in and teammates' moves show up without a reload.
 * Pass url=null to skip loading. The returned setLeads is what the board edits
 * through; it remembers which cards you touched so a refresh won't undo them.
 */
export function useLiveLeads(url: string | null, intervalMs = CRM_REFRESH_MS) {
  const [leads, setLeadsState] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const touchedAt = useRef(new Map<string, number>());
  const setLeads = useCallback<React.Dispatch<React.SetStateAction<Lead[]>>>((update) => {
    setLeadsState((cur) => {
      const next = typeof update === "function" ? update(cur) : update;
      const at = Date.now();
      for (const id of changedLeadIds(cur, next)) touchedAt.current.set(id, at);
      return next;
    });
  }, []);

  const asOf = useRef<string | null>(null);
  const needFull = useRef(false);
  const applyDelta = useCallback((d: LeadsResponse) => {
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

  // First load (and again whenever the board switches, e.g. to a downline agent).
  useEffect(() => {
    let active = true;
    asOf.current = null;
    needFull.current = false;
    touchedAt.current.clear();
    if (!url) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: LeadsResponse) => {
        if (!active) return;
        setLeadsState(d.leads ?? []);
        asOf.current = d.asOf ?? null;
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url]);

  // Live refresh while the tab is visible, and right away when you come back to it.
  useEffect(() => {
    if (!url) return;
    let live = true;
    let busy = false;
    const refresh = async () => {
      if (busy || document.visibilityState !== "visible" || !asOf.current) return;
      busy = true;
      try {
        const full = needFull.current;
        const sep = url.includes("?") ? "&" : "?";
        const r = await fetch(full ? url : `${url}${sep}since=${encodeURIComponent(asOf.current)}`, { cache: "no-store" });
        const d = r.ok ? ((await r.json()) as LeadsResponse) : null;
        if (live && d) {
          if (full) needFull.current = false;
          applyDelta(full ? { ...d, ids: (d.leads ?? []).map((l) => l.id) } : d);
        }
      } catch {
        // Offline or a blip; the next tick tries again.
      } finally {
        busy = false;
      }
    };
    const t = setInterval(refresh, intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      live = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [url, intervalMs, applyDelta]);

  return { leads, setLeads, loading, error };
}
