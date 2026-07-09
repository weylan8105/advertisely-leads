"use client";

import { useState } from "react";
import { Download, FileSpreadsheet, Webhook, Loader2, Check, Lock } from "lucide-react";
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
  const [ghlLoading, setGhlLoading] = useState(false);
  const [ghlDone, setGhlDone] = useState(false);

  // ── CSV download ──────────────────────────────────────────────────
  async function downloadCSV() {
    setCsvLoading(true);
    try {
      const params = new URLSearchParams();
      if (leadIds.length > 0) {
        params.set("leadIds", leadIds.join(","));
      }
      const res = await fetch(`/api/exports/csv?${params.toString()}`);
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

  // ── GHL push ──────────────────────────────────────────────────────
  async function pushToGHL() {
    if (leadIds.length === 0) {
      onError?.("Select at least one lead to push to GoHighLevel.");
      return;
    }
    setGhlLoading(true);
    setGhlDone(false);
    try {
      const res = await fetch("/api/exports/ghl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError?.(data.error ?? "GHL push failed.");
        return;
      }
      setGhlDone(true);
      onSuccess?.(
        `Pushed ${data.pushed} lead${data.pushed === 1 ? "" : "s"} to GoHighLevel.${data.failed > 0 ? ` ${data.failed} failed.` : ""}`,
      );
      setTimeout(() => setGhlDone(false), 3000);
    } catch {
      onError?.("Failed to push to GoHighLevel. Check your GHL connection in Settings.");
    } finally {
      setGhlLoading(false);
    }
  }

  // ── Google Sheets (stub — coming soon) ───────────────────────────
  function openSheetsComingSoon() {
    onError?.("Google Sheets sync is coming soon. Connect your sheet in Settings → Integrations.");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size="sm" disabled={csvLoading || ghlLoading}>
          {csvLoading || ghlLoading ? (
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
        <DropdownMenuItem onClick={openSheetsComingSoon} className="text-muted-foreground">
          <FileSpreadsheet className="h-4 w-4 mr-2 text-emerald-600" />
          Send to Google Sheets
          <Lock className="h-3 w-3 ml-auto text-muted-foreground" />
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>CRM destinations</DropdownMenuLabel>

        {/* GoHighLevel */}
        <DropdownMenuItem onClick={pushToGHL} disabled={ghlLoading}>
          {ghlLoading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : ghlDone ? (
            <Check className="h-4 w-4 mr-2 text-emerald-600" />
          ) : (
            <span className="h-4 w-4 mr-2 grid place-items-center text-amber-600 font-bold text-[10px]">GHL</span>
          )}
          Push to GoHighLevel
          {leadIds.length > 0 && (
            <span className="ml-auto text-[10px] text-muted-foreground">{leadIds.length}</span>
          )}
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
