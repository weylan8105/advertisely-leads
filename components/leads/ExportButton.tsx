"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Webhook, Loader2, Lock, Gem, Layers, KanbanSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ExportButtonProps {
  /** Selected lead IDs to export. If empty, exports all assigned leads. */
  leadIds?: string[];
  count?: number;
  variant?: "default" | "outline" | "subtle";
  onSuccess?: (msg: string) => void;
  onError?: (msg: string) => void;
  /** Offer My pipeline / Goldmine / Both instead of a single "everything" export (dashboard). */
  scopes?: boolean;
}

type Scope = "pipeline" | "goldmine" | "both";
const SCOPE_OPTIONS: { scope: Scope; label: string; icon: typeof Download; needsGoldmine: boolean }[] = [
  { scope: "pipeline", label: "My pipeline", icon: KanbanSquare, needsGoldmine: false },
  { scope: "goldmine", label: "Team Goldmine", icon: Gem, needsGoldmine: true },
  { scope: "both", label: "Pipeline + Goldmine", icon: Layers, needsGoldmine: true },
];
const SCOPE_NAME: Record<Scope, string> = { pipeline: "your pipeline", goldmine: "Goldmine", both: "your pipeline + Goldmine" };

export function ExportButton({
  leadIds = [],
  count,
  variant = "outline",
  onSuccess,
  onError,
  scopes = false,
}: ExportButtonProps) {
  const [csvLoading, setCsvLoading] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const useScopes = scopes && leadIds.length === 0;

  // Goldmine options only when the team has Goldmine turned on.
  const [goldmineOn, setGoldmineOn] = useState(false);
  useEffect(() => {
    if (!useScopes) return;
    let live = true;
    fetch("/api/goldmine")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setGoldmineOn(!!d?.enabled))
      .catch(() => {});
    return () => { live = false; };
  }, [useScopes]);
  const scopeOptions = SCOPE_OPTIONS.filter((o) => goldmineOn || !o.needsGoldmine);

  function exportParams(scope?: Scope) {
    const params = new URLSearchParams();
    if (leadIds.length > 0) {
      params.set("leadIds", leadIds.join(","));
    }
    if (scope) params.set("scope", scope);
    return params.toString();
  }

  // ── CSV download ──────────────────────────────────────────────────
  async function downloadCSV(scope?: Scope) {
    setCsvLoading(true);
    try {
      const res = await fetch(`/api/exports/csv?${exportParams(scope)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        onError?.(err.error ?? "CSV export failed.");
        return;
      }
      const n = res.headers.get("X-Lead-Count");
      if (scope && n === "0") {
        onError?.(`No leads in ${SCOPE_NAME[scope]} to export.`);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = cd.match(/filename="([^"]+)"/);
      a.download = match?.[1] ?? "advertisely-leads.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onSuccess?.(
        scope
          ? `CSV downloaded — ${n} leads from ${SCOPE_NAME[scope]}.`
          : `CSV downloaded — ${leadIds.length > 0 ? leadIds.length : "all"} leads.`,
      );
    } catch {
      onError?.("Failed to download CSV. Please try again.");
    } finally {
      setCsvLoading(false);
    }
  }

  // ── Google Sheets ─────────────────────────────────────────────────
  // Copies leads (as TSV) to the clipboard and opens a fresh Google Sheet to
  // paste into. Works without any Google account setup on our side.
  async function sendToSheets(scope?: Scope) {
    setSheetsLoading(true);
    try {
      const res = await fetch(`/api/exports/sheets?${exportParams(scope)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        onError?.(err.error ?? "Google Sheets export failed.");
        return;
      }
      const tsv = await res.text();
      const leadCount = res.headers.get("X-Lead-Count");
      if (leadCount === "0") {
        onError?.(scope ? `No leads in ${SCOPE_NAME[scope]} to export.` : "No leads to export yet.");
        return;
      }

      try {
        await navigator.clipboard.writeText(tsv);
      } catch {
        onError?.(
          "Couldn't access your clipboard. Allow clipboard permission for this site, or use Download CSV instead.",
        );
        return;
      }

      window.open("https://sheets.new", "_blank", "noopener,noreferrer");
      onSuccess?.(
        `Copied ${leadCount ?? "all"} leads${scope ? ` from ${SCOPE_NAME[scope]}` : ""} to your clipboard. Paste (⌘/Ctrl+V) into the Google Sheet that just opened — if it didn't open, go to sheets.new and paste.`,
      );
    } catch {
      onError?.("Failed to export to Google Sheets. Please try again.");
    } finally {
      setSheetsLoading(false);
    }
  }

  const busy = csvLoading || sheetsLoading;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" disabled={busy}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export{count !== undefined ? ` (${count})` : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {useScopes ? (
          <>
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5" /> Download CSV
            </DropdownMenuLabel>
            {scopeOptions.map((o) => (
              <DropdownMenuItem key={`csv-${o.scope}`} onClick={() => downloadCSV(o.scope)} disabled={busy}>
                <o.icon className="h-4 w-4 mr-2 text-muted-foreground" />
                {o.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" /> Send to Google Sheets
            </DropdownMenuLabel>
            {scopeOptions.map((o) => (
              <DropdownMenuItem key={`sheets-${o.scope}`} onClick={() => sendToSheets(o.scope)} disabled={busy}>
                <o.icon className="h-4 w-4 mr-2 text-muted-foreground" />
                {o.label}
              </DropdownMenuItem>
            ))}
          </>
        ) : (
        <>
        <DropdownMenuLabel>Export destination</DropdownMenuLabel>

        {/* CSV */}
        <DropdownMenuItem onClick={() => downloadCSV()} disabled={csvLoading}>
          {csvLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Download CSV
          {leadIds.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">{leadIds.length} selected</span>
          )}
        </DropdownMenuItem>

        {/* Google Sheets */}
        <DropdownMenuItem onClick={() => sendToSheets()} disabled={sheetsLoading}>
          {sheetsLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" />
          )}
          Send to Google Sheets
          {leadIds.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">{leadIds.length}</span>
          )}
        </DropdownMenuItem>
        </>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuLabel>CRM destinations</DropdownMenuLabel>

        {/* GoHighLevel — coming soon */}
        <DropdownMenuItem disabled className="text-muted-foreground">
          <span className="h-4 w-4 mr-2 grid place-items-center text-amber-600 font-bold text-[10px]">GHL</span>
          Push to GoHighLevel
          <Lock className="h-3 w-3 ml-auto" />
        </DropdownMenuItem>

        {/* Salesforce — coming soon */}
        <DropdownMenuItem disabled className="text-muted-foreground">
          <span className="h-4 w-4 mr-2 grid place-items-center text-sky-600 font-bold text-[10px]">SF</span>
          Push to Salesforce
          <Lock className="h-3 w-3 ml-auto" />
        </DropdownMenuItem>

        {/* HubSpot — coming soon */}
        <DropdownMenuItem disabled className="text-muted-foreground">
          <span className="h-4 w-4 mr-2 grid place-items-center text-orange-600 font-bold text-[10px]">HS</span>
          Push to HubSpot
          <Lock className="h-3 w-3 ml-auto" />
        </DropdownMenuItem>

        {/* Webhook — coming soon */}
        <DropdownMenuItem disabled className="text-muted-foreground">
          <Webhook className="h-4 w-4 mr-2" />
          Trigger custom webhook
          <Lock className="h-3 w-3 ml-auto" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
