"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Webhook, Loader2, Lock } from "lucide-react";
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
}

export function ExportButton({
  leadIds = [],
  count,
  variant = "outline",
  onSuccess,
  onError,
}: ExportButtonProps) {
  const [csvLoading, setCsvLoading] = useState(false);
  const [sheetsLoading, setSheetsLoading] = useState(false);

  function exportParams() {
    const params = new URLSearchParams();
    if (leadIds.length > 0) {
      params.set("leadIds", leadIds.join(","));
    }
    return params.toString();
  }

  // ── CSV download ──────────────────────────────────────────────────
  async function downloadCSV() {
    setCsvLoading(true);
    try {
      const res = await fetch(`/api/exports/csv?${exportParams()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        onError?.(err.error ?? "CSV export failed.");
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
      onSuccess?.(`CSV downloaded — ${leadIds.length > 0 ? leadIds.length : "all"} leads.`);
    } catch {
      onError?.("Failed to download CSV. Please try again.");
    } finally {
      setCsvLoading(false);
    }
  }

  // ── Google Sheets ─────────────────────────────────────────────────
  // Copies leads (as TSV) to the clipboard and opens a fresh Google Sheet to
  // paste into. Works without any Google account setup on our side.
  async function sendToSheets() {
    setSheetsLoading(true);
    try {
      const res = await fetch(`/api/exports/sheets?${exportParams()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        onError?.(err.error ?? "Google Sheets export failed.");
        return;
      }
      const tsv = await res.text();
      const leadCount = res.headers.get("X-Lead-Count");
      if (leadCount === "0") {
        onError?.("No leads to export yet.");
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
        `Copied ${leadCount ?? "all"} leads to your clipboard. Paste (⌘/Ctrl+V) into the Google Sheet that just opened — if it didn't open, go to sheets.new and paste.`,
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
        <DropdownMenuLabel>Export destination</DropdownMenuLabel>

        {/* CSV */}
        <DropdownMenuItem onClick={downloadCSV} disabled={csvLoading}>
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
        <DropdownMenuItem onClick={sendToSheets} disabled={sheetsLoading}>
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
