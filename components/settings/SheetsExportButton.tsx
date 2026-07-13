"use client";

import { useState } from "react";
import { FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

// Exports all of the current user's leads to Google Sheets by copying them to
// the clipboard (as TSV) and opening a fresh sheet to paste into. No Google
// account connection required on our side.
export function SheetsExportButton() {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);

  async function exportToSheets() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/exports/sheets");
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Export failed" }));
        setStatus({ type: "error", message: err.error ?? "Google Sheets export failed." });
        return;
      }
      const tsv = await res.text();
      const leadCount = res.headers.get("X-Lead-Count");
      if (leadCount === "0") {
        setStatus({ type: "error", message: "No leads to export yet. Order leads from the Marketplace first." });
        return;
      }
      try {
        await navigator.clipboard.writeText(tsv);
      } catch {
        setStatus({
          type: "error",
          message: "Couldn't access your clipboard. Allow clipboard permission, or use CSV export from the Leads CRM.",
        });
        return;
      }
      window.open("https://sheets.new", "_blank", "noopener,noreferrer");
      setStatus({
        type: "success",
        message: `Copied ${leadCount} leads. Paste (⌘/Ctrl+V) into the Google Sheet that just opened.`,
      });
    } catch {
      setStatus({ type: "error", message: "Failed to export to Google Sheets. Please try again." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={exportToSheets} disabled={loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
        )}
        Export all leads to Google Sheets
      </Button>
      {status && (
        <div
          className={`flex items-start gap-2 text-xs ${
            status.type === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {status.type === "success" ? (
            <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          )}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
}
